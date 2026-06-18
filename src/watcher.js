const db = require('./db');
const parser = require('./parser');
const sql = require('mssql');
const EventEmitter = require('events');

class SmsWatcher extends EventEmitter {
  constructor() {
    super();
    this.lastSeqNo = 0n;
    this.isWatching = false;
    this.timer = null;
    this.checkInterval = 2000; // 2초 주기로 감시 (자원 소모 거의 없음)
  }

  async start() {
    if (this.isWatching) return;
    this.isWatching = true;
    console.log('실시간 SMS 감시기 시작...');
    
    try {
      const smsPool = db.getSmsPool();
      if (!smsPool) throw new Error('SMS DB 풀이 존재하지 않습니다.');
      
      // 1. 최초 기동 시 마지막 SEQNO 조회
      const result = await smsPool.request().query('SELECT TOP 1 SEQNO FROM SMS ORDER BY SEQNO DESC');
      if (result.recordset.length > 0) {
        this.lastSeqNo = BigInt(result.recordset[0].SEQNO);
        console.log(`최초 시작 SMS SEQNO: ${this.lastSeqNo}`);
      }
      
      // 2. 주기적 모니터링 시작
      this.watch();
    } catch (err) {
      console.error('SMS 감시기 초기화 에러:', err.message);
      this.emit('error', err);
      this.isWatching = false;
    }
  }

  watch() {
    if (!this.isWatching) return;
    
    this.timer = setTimeout(async () => {
      try {
        await this.checkNewSms();
      } catch (err) {
        console.error('SMS 체크 에러:', err.message);
        this.emit('error', err);
      }
      this.watch(); // 재귀 호출로 다음 루프 실행
    }, this.checkInterval);
  }

  async checkNewSms() {
    const smsPool = db.getSmsPool();
    const bankPool = db.getBankPool();
    if (!smsPool || !bankPool) return;

    // lastSeqNo보다 큰 신규 문자 가져오기 (BigInt 바인딩)
    const result = await smsPool.request()
      .input('lastSeqNo', sql.BigInt, this.lastSeqNo)
      .query('SELECT SEQNO, R_NUM, DT, TM, MESSAGE FROM SMS WHERE SEQNO > @lastSeqNo ORDER BY SEQNO ASC');

    const newRecords = result.recordset;
    if (newRecords.length === 0) return;

    console.log(`[감시기] 신규 문자 ${newRecords.length}건 감지!`);

    for (const record of newRecords) {
      const { SEQNO, R_NUM, DT, TM, MESSAGE } = record;
      const currentSeq = BigInt(SEQNO);
      
      const parsed = parser.parseSMS(R_NUM, MESSAGE);
      if (parsed) {
        console.log(`[감시기] 파싱 성공 -> 발신: ${R_NUM}, 이름: ${parsed.bank_nm}, 금액: ${parsed.inout_amt}, 구분: ${parsed.inout_tp}`);
        
        try {
          // BANK_SMS에 중복 존재하는지 체크
          const checkDup = await smsPool.request()
            .input('seqno', sql.VarChar, SEQNO.toString())
            .query('SELECT COUNT(*) AS count FROM BANK_SMS WHERE SEQNO = @seqno');
          
          if (checkDup.recordset[0].count === 0) {
            // 2. BANK_SMS 테이블에 인서트 (TP = '1' - 초기값)
            await smsPool.request()
              .input('seqno', sql.VarChar, SEQNO.toString())
              .input('dt', sql.VarChar, DT)
              .input('tm', sql.VarChar, TM)
              .input('bank_no', sql.VarChar, parsed.bank_no)
              .input('jango', sql.VarChar, parsed.jango)
              .input('inout_amt', sql.VarChar, parsed.inout_amt.toString())
              .input('inout_tp', sql.VarChar, parsed.inout_tp)
              .input('bank_nm', sql.VarChar, parsed.bank_nm)
              .query(`
                INSERT INTO BANK_SMS (SEQNO, DT, TM, BANK_NO, JANGO, INOUT_AMT, INOUT_TP, BANK_NM, TP)
                VALUES (@seqno, @dt, @tm, @bank_no, @jango, @inout_amt, @inout_tp, @bank_nm, '1')
              `);
            
            // 3. BANK_LIST에서 회사 구분값(COMP) 가져오기
            const bankListRes = await smsPool.request()
              .input('bank_no', sql.VarChar, parsed.bank_no)
              .query('SELECT COMP FROM BANK_LIST WHERE BANK_NO = @bank_no');
            
            let comp = parsed.bank_no;
            if (bankListRes.recordset.length > 0 && bankListRes.recordset[0].COMP) {
              comp = bankListRes.recordset[0].COMP;
            }

            // 4. DSBH_2.dbo.BANK 테이블로 이관
            await bankPool.request()
              .input('dt', sql.VarChar, DT)
              .input('bank_no', sql.VarChar, comp)
              .input('jango', sql.VarChar, parsed.jango)
              .input('inout_amt', sql.VarChar, parsed.inout_amt.toString())
              .input('inout_tp', sql.VarChar, parsed.inout_tp)
              .input('bank_nm', sql.VarChar, parsed.bank_nm)
              .input('tm', sql.VarChar, TM)
              .query(`
                INSERT INTO BANK (DT, BANK_NO, JANGO, INOUT_AMT, INOUT_TP, BANK_NM, TP, TM, YEAR)
                VALUES (@dt, @bank_no, @jango, @inout_amt, @inout_tp, @bank_nm, '1', @tm, '2026')
              `);
            
            // 5. 이관 성공 후 BANK_SMS 테이블 완료 상태로 업데이트 (TP = '2')
            await smsPool.request()
              .input('seqno', sql.VarChar, SEQNO.toString())
              .query("UPDATE BANK_SMS SET TP = '2' WHERE SEQNO = @seqno AND TP = '1'");

            console.log(`[감시기] DB 이관 성공 -> BANK 테이블 삽입 완료 (SEQNO: ${SEQNO})`);

            // 6. 실시간 처리 매칭 이벤트 방출
            this.emit('sms', {
              seqno: SEQNO.toString(),
              dt: DT,
              tm: TM,
              bank_no: comp,
              inout_amt: parsed.inout_amt,
              inout_tp: parsed.inout_tp,
              bank_nm: parsed.bank_nm
            });
          }
        } catch (dbErr) {
          console.error(`[DB 이관 에러] SEQNO: ${SEQNO}, 오류:`, dbErr.message);
          this.emit('error', dbErr);
        }
      }
      
      // 최신 SEQNO로 갱신
      if (currentSeq > this.lastSeqNo) {
        this.lastSeqNo = currentSeq;
      }
    }
  }

  stop() {
    this.isWatching = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('실시간 SMS 감시기 중지.');
  }
}

module.exports = new SmsWatcher();
