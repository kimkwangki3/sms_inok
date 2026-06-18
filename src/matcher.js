const db = require('./db');
const sql = require('mssql');
const net = require('net');

const successLogs = [];
const errorLogs = [];
const MAX_LOG_SIZE = 100;

function addSuccessLog(log) {
  successLogs.unshift({ timestamp: new Date(), ...log });
  if (successLogs.length > MAX_LOG_SIZE) successLogs.pop();
}

function addErrorLog(message, err = null) {
  const errorDetail = err ? err.message : '';
  errorLogs.unshift({ timestamp: new Date(), message, detail: errorDetail });
  if (errorLogs.length > MAX_LOG_SIZE) errorLogs.pop();
  console.error(`[에러] ${message}`, err || '');
}

// 20200 포트 소켓 알림 전송 함수 (비동기)
function sendSocketNotification(host, port, userId, amount, isDeposit) {
  return new Promise((resolve) => {
    try {
      const a = '093NM001';
      const b = '00000180906208';
      const formattedAmt = Number(amount).toLocaleString();
      const text = isDeposit ? '입금처리가 완료되었습니다.' : '출금이 처리되었습니다.';
      
      const msg = (formattedAmt + text).padEnd(50, ' ');
      const userIdPad = userId.padEnd(20, ' ');
      const packet = a + userIdPad + b + msg + 'Y';

      const client = new net.Socket();
      client.setTimeout(3000); // 3초 타임아웃
      
      client.connect(port, host, () => {
        client.write(packet);
        client.end();
      });

      client.on('data', () => {});
      
      client.on('close', () => {
        resolve(true);
      });

      client.on('error', (err) => {
        addErrorLog(`소켓 전송 실패 (${host}:${port}) - ID: ${userId.trim()}`, err);
        client.destroy();
        resolve(false);
      });

      client.on('timeout', () => {
        addErrorLog(`소켓 타임아웃 (${host}:${port}) - ID: ${userId.trim()}`);
        client.destroy();
        resolve(false);
      });
    } catch (e) {
      addErrorLog('소켓 통신 처리 실패', e);
      resolve(false);
    }
  });
}

// 입출금 매칭 핵심 로직
async function processMatch(smsData, companies) {
  const { seqno, dt, tm, bank_no, inout_amt, inout_tp, bank_nm } = smsData;
  const bankPool = db.getBankPool();
  if (!bankPool) return false;

  let matched = false;

  for (const company of companies) {
    if (!company.enabled) continue;

    const compPool = db.getCompanyPool(company.id);
    if (!compPool) {
      continue;
    }

    try {
      let query = '';
      const request = compPool.request();
      request.input('bank_nm', sql.VarChar, bank_nm.trim());
      request.input('amt', sql.Decimal(18, 0), inout_amt);

      if (inout_tp === '입금') {
        query = `
          SELECT TOP 1 USER_ID, RQST_TM, RQST_AMT 
          FROM INOUT 
          WHERE IO_TP = '1' AND RSLT_TP = '0' 
            AND USER_BANK_ACNT_NM LIKE '%' + @bank_nm + '%' 
            AND RQST_AMT = @amt
          ORDER BY RQST_TM ASC
        `;
      } else {
        const amtMin = inout_amt - 1000;
        request.input('amtMin', sql.Decimal(18, 0), amtMin);
        
        query = `
          SELECT TOP 1 USER_ID, RQST_TM, RQST_AMT 
          FROM INOUT 
          WHERE IO_TP = '2' AND RSLT_TP = '0' 
            AND USER_BANK_ACNT_NM = @bank_nm 
            AND RQST_AMT BETWEEN @amtMin AND @amt
          ORDER BY RQST_TM ASC
        `;
      }

      const res = await request.query(query);
      if (res.recordset.length > 0) {
        const { USER_ID, RQST_TM, RQST_AMT } = res.recordset[0];
        
        console.log(`[매칭 성공] 업체: ${company.name}, 회원 ID: ${USER_ID}, 금액: ${RQST_AMT}`);

        // 1. 업체 DB 승인 프로시저 실행 (PT_INOUT_PROC)
        await compPool.request()
          .input('userId', sql.VarChar, USER_ID)
          .input('rqstTm', sql.VarChar, RQST_TM)
          .input('rsltTp', sql.VarChar, '1')
          .input('rqstAmt', sql.Decimal(18, 0), RQST_AMT)
          .input('processor', sql.VarChar, 'Alpha-go')
          .input('dummy', sql.VarChar, '')
          .query("EXEC PT_INOUT_PROC @userId, @rqstTm, @rsltTp, @rqstAmt, @processor, @dummy");

        // 2. DSBH_2.dbo.BANK 테이블 레코드 처리 상태 업데이트 (TP = '2')
        await bankPool.request()
          .input('dt', sql.VarChar, dt)
          .input('bank_no', sql.VarChar, bank_no)
          .input('amt', sql.VarChar, inout_amt.toString())
          .input('bank_nm', sql.VarChar, bank_nm)
          .query(`
            UPDATE BANK 
            SET TP = '2' 
            WHERE TP = '1' 
              AND LTRIM(RTRIM(DT)) = LTRIM(RTRIM(@dt)) 
              AND BANK_NO = @bank_no 
              AND INOUT_AMT = @amt 
              AND BANK_NM = @bank_nm
          `);

        // 3. 알림 소켓 비동기 전송
        sendSocketNotification(company.socket_host, company.socket_port, USER_ID, RQST_AMT, inout_tp === '입금');

        // 4. 성공 로그 저장
        addSuccessLog({
          seqno,
          company: company.name,
          user_id: USER_ID,
          bank_nm,
          amount: RQST_AMT,
          type: inout_tp
        });

        matched = true;
        break;
      }
    } catch (err) {
      addErrorLog(`업체 [${company.name}] 매칭 처리 중 DB 에러:`, err);
    }
  }

  return matched;
}

// 과거 미처리 건에 대한 주기적 재매칭 스케줄러
let periodicTimer = null;
function startPeriodicScheduler(getCompaniesFn, intervalMs = 30000) {
  if (periodicTimer) clearInterval(periodicTimer);

  periodicTimer = setInterval(async () => {
    const bankPool = db.getBankPool();
    if (!bankPool) return;

    try {
      const res = await bankPool.request()
        .query("SELECT TOP 50 DT, BANK_NO, JANGO, INOUT_AMT, INOUT_TP, BANK_NM, TM FROM BANK WHERE TP = '1' ORDER BY DT DESC, TM DESC");

      const pendingRecords = res.recordset;
      if (pendingRecords.length === 0) return;

      console.log(`[스케줄러] 대기 중인 과거 미처리 내역 ${pendingRecords.length}건 재검사 중...`);
      const companies = getCompaniesFn();

      for (const record of pendingRecords) {
        const smsData = {
          seqno: 'PAST_PENDING',
          dt: record.DT,
          tm: record.TM,
          bank_no: record.BANK_NO,
          inout_amt: parseFloat(record.INOUT_AMT) || 0,
          inout_tp: record.INOUT_TP,
          bank_nm: record.BANK_NM
        };

        await processMatch(smsData, companies);
      }
    } catch (err) {
      addErrorLog('재매칭 스케줄러 구동 실패:', err);
    }
  }, intervalMs);
}

// 스케줄러 중지 함수
function stopPeriodicScheduler() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
    console.log('[스케줄러] 과거 미처리 재매칭 스케줄러 중지 완료.');
  }
}

module.exports = {
  processMatch,
  startPeriodicScheduler,
  stopPeriodicScheduler,
  successLogs,
  errorLogs,
  addErrorLog,
  addSuccessLog
};
