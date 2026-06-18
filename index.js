const path = require('path');
const fs = require('fs');
const db = require('./src/db');
const watcher = require('./src/watcher');
const matcher = require('./src/matcher');
const { createServer } = require('./src/server');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// 1. 설정 파일 로드
let config = {};
try {
  const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = JSON.parse(configRaw);
} catch (err) {
  console.error('설정 파일(config.json)을 로드하지 못했습니다.', err);
  process.exit(1);
}

// 대시보드 동적 설정 변경에 따른 런타임 데이터 동기화 콜백
function updateRuntimeConfig(newConfig) {
  config = newConfig;
  console.log('[SYSTEM] 런타임 업체 설정이 실시간으로 동기화되었습니다.');
}

async function main() {
  try {
    // 2. 모든 데이터베이스 커넥션 풀 초기화
    await db.initPools(config);

    // 3. 실시간 SMS DB 감시기 구동
    await watcher.start();

    // 4. 신규 SMS 유입 이벤트 수신 및 매칭 처리
    watcher.on('sms', async (smsData) => {
      console.log(`[SYSTEM] 신규 파싱 SMS 수신 -> 실시간 매칭 개시 (SEQNO: ${smsData.seqno})`);
      const matched = await matcher.processMatch(smsData, config.companies);
      if (matched) {
        console.log(`[SYSTEM] SMS 자동 매칭 승인 완료 (SEQNO: ${smsData.seqno})`);
      } else {
        console.log(`[SYSTEM] SMS 매칭 일치 신청 없음 -> 대기 유지 (SEQNO: ${smsData.seqno})`);
      }
    });

    watcher.on('error', (err) => {
      matcher.addErrorLog('SMS 감시기 이벤트 에러 발생:', err);
    });

    // 5. 과거 미처리 누적 건 재매칭 백그라운드 스케줄러 가동 (30초 주기)
    matcher.startPeriodicScheduler(() => config.companies, 30000);
    console.log('[SYSTEM] 과거 미처리 대기 건 주기적 재매칭 스케줄러 가동 완료 (30초 주기)');

    // 6. 대시보드 API 및 Express 웹 서버 구동
    const app = createServer(CONFIG_PATH, config, updateRuntimeConfig);
    const port = config.web_port || 3000;
    
    const server = app.listen(port, () => {
      console.log(`==================================================`);
      console.log(`   SMS 실시간 자동 입출금 매칭 시스템 가동 완료   `);
      console.log(`   대시보드 웹 주소: http://localhost:${port}   `);
      console.log(`==================================================`);
    });

    // 프로세스 종료 시 안정적으로 커넥션 릴리즈
    const shutdown = async () => {
      console.log('\n[SYSTEM] 시스템 종료 프로세스를 시작합니다...');
      watcher.stop();
      server.close();
      await db.closeAllPools();
      console.log('[SYSTEM] 모든 DB 커넥션 풀 및 포트 연결이 닫혔습니다.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('시스템 부팅 단계 에러:', err);
    process.exit(1);
  }
}

main();
