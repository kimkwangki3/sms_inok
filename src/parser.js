function parseSMS(rNum, message) {
  if (!message) return null;
  
  // 개행 정규화 및 잔액 공백 띄우기 표준화
  const normalizedMsg = message
    .replace(/\r/g, '')
    .replace(/잔액\s*/g, ' 잔액 ')
    .trim();

  try {
    switch (rNum) {
      // 1. KB국민은행 (16449999)
      case '16449999': {
        const kbIdx = normalizedMsg.indexOf('[KB]');
        if (kbIdx === -1) return null;

        const cleanPart = normalizedMsg.substring(kbIdx);
        // 공백 및 괄호 기준 토큰화
        const tokens = cleanPart.split(/[\s()]+/).filter(Boolean);
        
        // tokens 구조 예:
        // 유형 A: ['[KB]06/18', '11:20', '08001**626', '입금', '홍길동', '10,000', '잔액', '120,000']
        // 유형 B: ['[KB]06/18', '15:05', '762301**868', '강수연', '입금', '1,032,649', '잔액', '43,753,753']
        
        const bankNo = tokens[2] || '';
        
        // 입/출금 키워드 인덱스 찾기
        const actionIdx = tokens.findIndex(t => t.includes('입금') || t.includes('출금') || t.includes('인터넷뱅킹'));
        if (actionIdx === -1) return null;

        const typeRaw = tokens[actionIdx];
        const inoutTp = typeRaw.includes('입금') ? '입금' : '출금';

        let name = '';
        let amt = '0';

        // 입출 키워드 앞쪽에 이름이 있는지(유형 B) 혹은 뒤쪽에 이름이 있는지(유형 A) 식별
        if (actionIdx - 1 > 2) {
          // 유형 B: [계좌번호] [강수연] [입금]
          name = tokens[actionIdx - 1];
          amt = tokens[actionIdx + 1] || '0';
        } else {
          // 유형 A: [계좌번호] [입금] [홍길동]
          name = tokens[actionIdx + 1] || '';
          amt = tokens[actionIdx + 2] || '0';
        }

        // 잔액 파싱
        let jango = '';
        const janIdx = tokens.indexOf('잔액');
        if (janIdx > -1 && tokens[janIdx + 1]) {
          jango = tokens[janIdx + 1];
        }

        // 이름 클리닝 (숫자나 불필요한 단어가 이름으로 잘못 잡히는 경우 방지)
        const cleanName = name.replace(/[^가-힣a-zA-Z]/g, '').trim();

        return {
          bank_no: bankNo,
          bank_nm: cleanName || '미상',
          inout_amt: parseInt(amt.replace(/[^0-9]/g, '')) || 0,
          inout_tp: inoutTp,
          jango: jango.replace(/[^0-9]/g, '')
        };
      }
      
      // 2. IBK기업은행 (15662566)
      case '15662566': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
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
      
      // 3. 농협은행 (15882100)
      case '15882100': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
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
      
      // 4. 우체국 (15999000)
      case '15999000': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        const bankNo = (tokens[1] || '').trim();
        const nameRaw = (tokens[2] || '').trim();
        
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
      
      // 5. 신한은행 (15778000)
      case '15778000': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        const bankNo = (tokens[1] || '').trim();
        const inoutTp = tokens[2] && tokens[2].includes('입금') ? '입금' : '출금';
        const amt = (tokens[3] || '').replace(/[^0-9]/g, '');
        const jango = (tokens[5] || '').replace(/[^0-9]/g, '');
        const nameRaw = (tokens[6] || '').trim();
        const name = nameRaw.slice(-3);
        
        return {
          bank_no: bankNo,
          bank_nm: name,
          inout_amt: parseInt(amt) || 0,
          inout_tp: inoutTp,
          jango: jango
        };
      }
      
      // 6. 우리은행 (15885000)
      case '15885000': {
        const tokens = normalizedMsg.split(/[\s\n]+/).filter(Boolean);
        
        const bankNo = (tokens[1] || '').trim();
        const inoutTp = tokens[2] && tokens[2].includes('입금') ? '입금' : '출금';
        const amt = (tokens[3] || '').replace(/[^0-9]/g, '');
        const nameRaw = (tokens[4] || '').trim();
        const name = nameRaw.slice(-3);
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
