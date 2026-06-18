function parseSMS(rNum, message) {
  if (!message) return null;
  
  // 개행 및 캐리지 리턴 정규화
  const normalizedMsg = message.replace(/\r/g, '').trim();

  try {
    switch (rNum) {
      // 1. KB국민은행
      case '16449999': {
        // 마스킹 별표(*)를 포함하여 매칭하도록 [\d*-]+ 패턴 사용 및 이름의 괄호 유무 대응
        const match = normalizedMsg.match(/\[KB\]\s*\d{2}\/\d{2}\s+\d{2}:\d{2}\s+([\d*-]+)\s+(입금|출금|인터넷뱅킹)\s*(?:\((.*?)\)|([^\s]+))\s+([\d,]+)(?:\s*원)?\s+잔액\s*([\d,]+)/);
        
        if (match) {
          const bankNo = match[1];
          const typeRaw = match[2];
          const name = (match[3] || match[4] || '').trim();
          const amt = match[5].replace(/[^0-9]/g, '');
          const jango = match[6].replace(/[^0-9]/g, '');
          
          return {
            bank_no: bankNo,
            bank_nm: name,
            inout_amt: parseInt(amt) || 0,
            inout_tp: typeRaw.includes('입금') ? '입금' : '출금',
            jango: jango
          };
        }
        
        // 정규식 매칭 안 될 시 안전 장치: 토큰 분할 방식 (고정 substr 대비 가변 길이 완벽 대응)
        const kbIdx = normalizedMsg.indexOf('[KB]');
        if (kbIdx > -1) {
          const cleanPart = normalizedMsg.substring(kbIdx);
          const tokens = cleanPart.split(/[\s()]+/).filter(Boolean);
          // tokens 예: ['[KB]06/18', '11:20', '08001**626', '입금', '조희', '15,000', '잔액', '3,741,821']
          
          const bankNo = tokens[2] || '';
          const typeRaw = tokens[3] || '';
          const inoutTp = typeRaw.includes('입금') ? '입금' : '출금';
          
          let name = (tokens[4] || '').trim();
          let amt = (tokens[5] || '').replace(/[^0-9]/g, '');
          let jango = '0';
          
          const janIdx = tokens.indexOf('잔액');
          if (janIdx > -1 && tokens[janIdx + 1]) {
            jango = tokens[janIdx + 1].replace(/[^0-9]/g, '');
          }
          
          // 이름 비정상 검출 시 예외 처리
          if (name === '잔액' || /^[0-9,]+$/.test(name)) {
            name = '미상';
          }
          
          return {
            bank_no: bankNo,
            bank_nm: name,
            inout_amt: parseInt(amt) || 0,
            inout_tp: inoutTp,
            jango: jango
          };
        }
        
        return null;
      }
      
      // 2. IBK기업은행
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
      
      // 3. 농협은행
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
      
      // 4. 우체국
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
      
      // 5. 신한은행
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
      
      // 6. 우리은행
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
