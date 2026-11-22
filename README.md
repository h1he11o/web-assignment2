# 과제 2 신청 승인 서비스

웹서비스설계 한국어 분반 과제 2입니다. 학생이 행사에 참가 신청하고, 행사 담당 운영자가 정원 안에서 승인하거나 승인을 취소하는 서비스입니다. 승인이 취소되면 같은 행사의 대기자 중 가장 먼저 신청한 1명이 자동으로 승인되고, 모든 상태 변경은 변경 이력으로 남습니다.

- 상태·이력·입출력 계약: [docs/API.md](docs/API.md)
- 보고서: [docs/report.pdf](docs/report.pdf)
- 검증 캡처: [docs/evidences/](docs/evidences/)

## 구현 상태

**필수 범위 구현 완료.** 제공된 TODO 4개(apply, cancel, approve, revoke)를 모두 구현했습니다.

|항목|결과|
|---|---|
|`npm test` (제공 기반 4개)|4개 통과|
|`npm run test:assignment` (필수 T01~T32)|32개 통과, 0개 실패|
|`npm run test:advanced` (선택 심화)|1개 통과 (서버 2개 동시 승인 20회)|
|화면 검증 U01~U05|5개 모두 수행, 캡처는 `docs/evidences/U01-*.png` ~ `U05-*.png`|

실행 환경: Windows 11 Pro, Node.js v24.22.3, npm 11.19.1

## 실행

Node.js **24.x**와 npm이 필요합니다. Node.js 20은 지원하지 않습니다. SQLite는 Node 내장 모듈이라 별도 DB 서버가 필요 없습니다.

```sh
node --version
npm ci
npm test
npm start
```

http://127.0.0.1:3000 에 접속합니다. Ctrl+C로 종료합니다.

- 포트 사용 중: 기존 실행 터미널을 종료하거나 다른 포트를 사용합니다.
- macOS / Linux: `PORT=3001 npm start`
- Windows PowerShell: `$env:PORT="3001"; npm start`
- 첫 실행: `data/app.sqlite`와 `data/jwt-secret.txt`가 자동 생성됩니다. 두 파일은 저장소에 포함하지 않습니다(`.gitignore`).
- 브라우저 로그인 토큰은 메모리에만 저장합니다. 브라우저 새로고침(F5) 후에는 다시 로그인하세요. 다른 탭의 변경은 화면의 ‘최신 정보 새로고침’ 버튼으로 확인합니다. DB 데이터는 유지됩니다.
- 서버 시작 메시지의 “TODO 구현 전 501입니다” 문구는 제공 코드(`src/server.js`)의 고정 문구입니다. 구현을 마쳤으므로 실제로는 501이 반환되지 않습니다.

## DB 초기화

서버를 먼저 종료하고 아래 명령에서 `RESET`을 입력합니다. 신청·변경 이력을 지우고 초기 계정·행사를 다시 만듭니다.

```sh
npm run db:reset
```

선택 환경변수: PORT, DB_PATH, JWT_SECRET. 기본 실행에는 설정 파일이 필요 없습니다. 키 파일을 지우면 기존 토큰은 무효화됩니다.

## 연습 계정

공통 비밀번호는 `Classroom123!`입니다. 실제 이용자가 아닌 가상 계정입니다.

|아이디|이름|역할|
|---|---|---|
|alice|민지|학생|
|bob|준호|학생|
|charlie|서연|학생|
|manager1|운영자 A|행사 1 담당 · 정원 2명|
|manager2|운영자 B|행사 2 담당 · 정원 1명|

로그인 화면의 계정 버튼으로 입력값을 채우고 로그인 버튼을 누릅니다. 각 탭은 별도 토큰을 사용하므로 탭 여러 개로 학생과 운영자를 나눌 수 있습니다.

## 변경한 파일

|파일|구분|내용|
|---|---|---|
|`src/application-service.js`|직접 구현|TODO 4개(`apply`, `cancel`, `approve`, `revoke`), 공통 함수 `transaction`·`loadForManager`, 오류 `alreadyApplied`·`capacityFull`|
|`src/repository.js`|함수 1개 추가|`nextPending(eventId)`: 같은 행사의 PENDING 중 `created_at ASC, id ASC` 첫 1건 조회. 기존 함수는 수정하지 않음|
|`docs/report.pdf`, `docs/evidences/`|추가|보고서와 검증 캡처|
|`README.md`|수정|제출용 내용으로 정리|

그 외 `src/app.js`, `src/auth.js`, `src/db.js`, `src/server.js`, `public/`, `tests/`, `scripts/`는 제공 코드 그대로이며, 테스트 기대값은 바꾸지 않았습니다.

## 구현 요약

- **트랜잭션**: 네 기능 모두 `transaction(work)` 안에서 처리합니다. `BEGIN IMMEDIATE`로 시작해 검사와 저장이 끝나면 `COMMIT`하고, 중간에 예외가 나면 `ROLLBACK`한 뒤 오류를 다시 던집니다. 상태 변경과 이력 저장은 함께 저장되거나 함께 취소됩니다.
- **검사 순서**: (라우터) 인증 401 → ID·본문 형식 400 → (서비스) 대상 존재 404 → 권한 403 → 현재 상태 409 → 정원 409. 모든 검사는 트랜잭션 안에서 매 요청 DB를 다시 읽어 판단합니다.
- **중복 신청**: 상태와 관계없이 같은 행사에 기존 신청이 있으면 409 ALREADY_APPLIED입니다(취소·승인 취소 기록 포함).
- **정원**: APPROVED 인원만 세며, 직접 승인 시 정원 이상이면 409 CAPACITY_FULL입니다.
- **승인 취소와 자동 승급**: 대상 신청을 REVOKED로 바꾸고 REVOKE 이력(사유 포함)을 남긴 뒤, `nextPending`으로 같은 행사 대기자 1명을 APPROVED로 바꾸고 AUTO_APPROVE 이력을 남깁니다. AUTO_APPROVE의 `causeHistoryId`는 같은 요청의 REVOKE 이력 ID입니다. 대기자가 없으면 `promoted`는 `null`입니다.
- **동시성(선택 심화)**: `BEGIN IMMEDIATE`가 시작 시점에 SQLite 쓰기 잠금을 잡아, 다른 서버 프로세스가 정원 확인과 승인 저장 사이에 끼어들지 못하게 합니다. 20회 반복 통과는 모든 경쟁 상황이 없다는 증명은 아니며, 한계는 보고서에 정리했습니다.

## 테스트

```sh
npm test
npm run test:assignment
npm run test:advanced
```

- `npm test`: 제공 기반 기능 4개
- `test:assignment`: 필수 T01~T32
- `test:advanced`: 선택 심화. 서버 2개가 마지막 자리를 동시에 승인하는 검사를 20회 수행합니다.

테스트는 별도 임시 DB·포트를 사용합니다. T28~T30은 임시 DB 트리거로 이력 저장 실패를 일부러 일으키므로, 실행 중 출력되는 `TEST_INJECTED_FAILURE` 로그는 의도된 것입니다.

## 화면 검증

|ID|흐름|결과|
|---|---|---|
|U01|alice 신청 → manager1 승인 → 학생 화면 확인|201 PENDING → 200 APPROVED, 승인 1/2|
|U02|대기 취소 후 오래된 운영자 화면에서 승인|409 INVALID_STATE, CANCELLED 유지, 거부 요청 이력 없음|
|U03|서버 종료·재실행 후 재로그인|상태와 이력 유지|
|U04|새 DB, 행사 2에 alice·bob·charlie 순서로 신청 → alice 승인 → 승인 취소|bob 자동 승급, charlie 대기 유지, AUTO_APPROVE 원인 이력 = REVOKE 이력|
|U05|새 DB, alice만 신청·승인 → 승인 취소|REVOKED, `promoted: null`, 승인 0/1|

캡처는 [docs/evidences/](docs/evidences/)에 있고, 자세한 설명은 보고서 7장에 있습니다.

## 파일 구조

- `src/application-service.js`: 업무 규칙과 트랜잭션 (직접 구현)
- `src/repository.js`: 조회·저장·이력 저장 SQL (`nextPending` 추가)
- `src/db.js`: SQLite 스키마·초기 데이터
- `src/auth.js`: JWT 인증
- `src/app.js`: 라우팅·형식 검사·조회 권한·오류 응답
- `src/server.js`: 로컬 서버
- `public/`: 화면
- `tests/`: 기반·필수·선택 심화 테스트
- `docs/API.md`: 상태·이력·입출력 계약
- `docs/report.pdf`: 보고서
- `docs/evidences/`: 테스트·화면 검증 캡처

## AI 사용 요약

Claude Code(Anthropic, Claude Opus 5.5)를 사용했습니다. 과제 요구사항 분석, `application-service.js`의 TODO 4개와 `repository.js`의 `nextPending` 구현, 코드 설명, 보고서 초안과 다이어그램 작성에 활용했습니다. AI가 작성한 코드는 줄 단위로 설명을 듣고 직접 주석을 달아 이해했으며, 테스트 3종과 화면 검증 U01~U05는 직접 실행해 결과를 캡처했습니다. 자세한 내용은 보고서의 “AI 활용과 참고 자료”에 있습니다.

## 제출에서 제외한 것

`node_modules`, 생성된 DB(`data/app.sqlite`)·서명 키(`data/jwt-secret.txt`), `.env`, JWT 토큰, 개인 정보는 저장소에 포함하지 않습니다.

## 참고 문서

- [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Express API](https://expressjs.com/en/5x/api/)
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)
