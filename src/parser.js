function parseSMS(rNum, message) {
  if (!message) return null;
  
  // 개행 문자(\r, \n)를 공백으로 치환하여 분석하기 좋게 단일 라인으로 표준화
  const normalizedMsg = message.replace(/\r/g, '').trim();

  try {
    switch (rNum) {
      // 1. KB국민은행
      case '16449999': {
        // [KB]06/18 11:20 123-456-7890 입금 홍길동 10,000 잔액 120,000 형태 파싱
        // 또는 [KB]... 인터넷뱅킹 홍길동 20,000 잔액...
        // 정규식 매칭 시도
        const match = normalizedMsg.match(/\[KB\]\d{2}\/\d{2}\s\d{2}:\d{2}\s([\d-]+)\s(입금|출금|인터넷뱅킹)\s([^\s]+)\s([\d,]+)(?:\s원)?\s잔액\s*([\d,]+)/);
        
        if (match) {
          const bankNo = match[1];
          const typeRaw = match[2];
          const name = match[3];
          const amt = match[4].replace(/[^0-9]/g, '');
          const jango = match[5].replace(/[^0-9]/g, '');
          
          return {
            bank_no: bankNo,
            bank_nm: name,
            inout_amt: parseInt(amt) || 0,
            inout_tp: typeRaw.includes('입금') ? '입금' : '출금',
            jango: jango
          };
        }
        
        // 정규식 매칭 안 될 시 안전 장치로 기존 위치 기반 Substring 처리 시도
        const bank = normalizedMsg.substr(normalizedMsg.indexOf('[KB]') + 17, 11).trim(); // 대략 계좌번호 포지션
        let name = '';
        if (normalizedMsg.includes('인터넷뱅킹')) {
          name = normalizedMsg.substr(36, 3).trim();
        } else {
          name = normalizedMsg.substr(38, 3).trim();
        }
        
        const inoutTp = normalizedMsg.includes('입금') ? '입금' : '출금';
        let amt = '';
        let jango = '';
        const startIdx = normalizedMsg.indexOf(inoutTp) + inoutTp.length;
        const endIdx = normalizedMsg.indexOf('잔액');
        
        if (endIdx > -1) {
          amt = normalizedMsg.substring(startIdx, endIdx).replace(/[^0-9]/g, '');
          jango = normalizedMsg.substring(endIdx + 2).replace(/[^0-9]/g, '');
        } else {
          amt = normalizedMsg.substring(startIdx).replace(/[^0-9]/g, '');
        }

        return {
          bank_no: bank,
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      // 2. IBK기업은행
      case '15662566': {
        // 공백 및 개행 기준 토큰 분리
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        // ['기업은행', '계좌번호', '입금', '금액', '잔액', '잔액금액', '이름', '관리번호'] 형태 대응
        const inoutTp = tokens[2] && tokens[2].includes('입금') ? '입금' : '출금';
        const amt = (tokens[3] || '').replace(/[^0-9]/g, '');
        const jango = (tokens[5] || '').replace(/[^0-9]/g, '');
        const name = (tokens[6] || '').trim();
        const bankNo = (tokens[7] || '').trim();
        
        return {
          bank_no: bankNo || '608***92601012',
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      // 3. 농협은행
      case '15882100': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        // ['농협', '입금', '금액', '날짜', '시간', '계좌번호', '이름', '잔액', '잔액금액'] 형태 대응
        const inoutTp = tokens[1] && tokens[1].includes('입금') ? '입금' : '출금';
        const amt = (tokens[2] || '').replace(/[^0-9]/g, '');
        const bankNo = (tokens[5] || '').trim();
        const name = (tokens[6] || '').trim();
        const jango = (tokens[8] || '').replace(/[^0-9]/g, '');
        
        return {
          bank_no: bankNo,
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      // 4. 우체국
      case '15999000': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        // ['우체국', '계좌번호', '이름', '입금', '금액', '잔액', '잔액금액'] 형태 대응
        const bankNo = (tokens[1] || '').trim();
        const nameRaw = (tokens[2] || '').trim();
        
        // 특정 접두어 지우기
        const removeWords = ["공동-", "재단-", "우리-", "법인-", "주식-"];
        let name = nameRaw;
        for (const word of removeWords) {
          name = name.replace(new RegExp(word, 'g'), '');
        }
        
        const inoutTp = tokens[3] && tokens[3].includes('입금') ? '입금' : '출금';
        const amt = (tokens[4] || '').replace(/[^0-9]/g, '');
        const jango = (tokens[6] || '').replace(/[^0-9]/g, '');
        
        return {
          bank_no: bankNo,
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      // 5. 신한은행
      case '15778000': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        // ['신한은행', '계좌번호', '입금', '금액', '잔액', '잔액금액', '이름'] 형태 대응
        const bankNo = (tokens[1] || '').trim();
        const inoutTp = tokens[2] && tokens[2].includes('입금') ? '입금' : '출금';
        const amt = (tokens[3] || '').replace(/[^0-9]/g, '');
        const jango = (tokens[5] || '').replace(/[^0-9]/g, '');
        const nameRaw = (tokens[6] || '').trim();
        const name = nameRaw.slice(-3); // 마지막 3글자
        
        return {
          bank_no: bankNo,
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      // 6. 우리은행
      case '15885000': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        // ['우리은행', '계좌번호', '입금', '금액', '이름', '잔액', '잔액금액'] 형태 대응
        const bankNo = (tokens[1] || '').trim();
        const inoutTp = tokens[2] && tokens[2].includes('입금') ? '입금' : '출금';
        const amt = (tokens[3] || '').replace(/[^0-9]/g, '');
        const nameRaw = (tokens[4] || '').trim();
        const name = nameRaw.slice(-3); // 마지막 3글자
        const jango = (tokens[6] || '').replace(/[^0-9]/g, '');
        
        return {
          bank_no: bankNo,
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      default:
        return null;
    }
  } catch (err) {
    console.error(`SMS 파싱 실패 (발신번호: ${rNum}), 사유:`, err.message);
    return null;
  }
}

module.exports = {
  parseSMS
};
