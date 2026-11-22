import { AppError, missing, forbidden, invalidState } from './errors.js';

// TODO-01~04: 업무 규칙과 트랜잭션을 직접 구현합니다. docs/API.md를 먼저 읽으세요.
// actor는 검증된 로그인 사용자입니다. repo의 저장 함수는 권한을 검사하지 않습니다.
// 상태 변경과 이력 저장은 함께 성공하거나 함께 실패해야 합니다.
// 승인 취소와 자동 승급은 신청 2건 + 이력 2건을 한 트랜잭션으로 처리합니다.

const alreadyApplied = () => new AppError(409,'ALREADY_APPLIED','이미 이 행사에 신청한 기록이 있습니다.');
const capacityFull = () => new AppError(409,'CAPACITY_FULL','승인 정원이 모두 찼습니다.');

export function createApplicationService(repo) {
  const db = repo.db; // repository가 들고 있는 DB 연결을 꺼내서 db라는 이름으로 씀

  function transaction(work) { // work는 각 기능이 할 일을 함수로 만듦
    db.exec('BEGIN IMMEDIATE'); // 쓰기 잠금, 다른 요청이 동시에 못 씀
    try { // 넘겨받은 할 일을 실행하고 결과를 result로 받음
      const result = work();
      db.exec('COMMIT');
      return result; // 중간에 오류 없이 왔으면 확정하고 결과를 돌려줌 -> DB반영
    } catch (err) { // throw가 일어나면 여기로 점프
      if (db.isTransaction) db.exec('ROLLBACK'); // 전부 취소, 상태 바꿔 놨으면 시작 전으로 돌아감
      throw err;
    }
  }

  // 신청을 찾고, 행사 담당 운영자인지 확인합니다(approve·revoke 공통).
  function loadForManager(actor, applicationId) {
      // actor: 로그인 한 사람, applicationId: 처리할 신청 번호
    const application = repo.application(applicationId);
    if (!application) throw missing('신청');
    // 신청 번호로 DB에서 신청을 찾음, 없으면 404
    const event = repo.event(application.eventId);
    // 그 신청으로 어느 행사 것인지 알아내서 행사 정보를 가져옴
    if (actor.role !== 'MANAGER' || event.managerId !== actor.id) throw forbidden();
    // 운영자가 아니거나 운영자가 이 행사 담당이 아니면 403
    return { application, event };
    // 검사를 통과하면 신청과 행사를 둘 다 묶어서 돌려줌
  }

  return {
    apply(actor, eventId) {
      // TODO-01: 행사·학생 역할·중복 검사 → PENDING 저장 + APPLY 이력.
      // 취소·승인 취소 기록도 중복입니다. 반환: 신청 객체.
      return transaction(() => {
        const event = repo.event(eventId);
        if (!event) throw missing('행사');
        // 행사 번호로 행사를 찾음, 없으면 404
        if (actor.role !== 'STUDENT') throw forbidden();
        // 로그인 한 사람이 학생이 아니면 403
        if (repo.existing(event.id, actor.id)) throw alreadyApplied();
        // 이 행사에 이 학생이 신청한 기록이 있는지 확인하고 있으면 alreadyApplied()
        const created = repo.insert(event.id, actor.id);
        // 신청 저장, 상태는 PENDING, created에는 방금 만들어진 신청 객체가 들어옴
        repo.addHistory({ applicationId: created.id, actorId: actor.id, action: 'APPLY', fromStatus: null, toStatus: 'PENDING' });
        // 방금 만든 신청 번호, 누가 했는지, 무슨 행동인지, 전 상태, 후 상태, 생성 시간 이력을 남김
          // reason, causeHistoryId는 null
        return created;
        // 신청 객체를 돌려줌
      });
    },

    cancel(actor, applicationId) {
      // TODO-02: 본인의 PENDING만 CANCELLED로 변경 + CANCEL 이력.
      // 학생의 대기 취소는 승인 자리를 비우지 않으므로 자동 승급하지 않습니다.
      return transaction(() => {
        const application = repo.application(applicationId);
        if (!application) throw missing('신청');
        // 신청 번호로 신청을 찾음, 없으면 404
        if (actor.role !== 'STUDENT' || application.userId !== actor.id) throw forbidden();
        // 학생이 아니거나 본인 신청이 아니면 403
        if (application.status !== 'PENDING') throw invalidState();
        // 지금 상태가 PENDING이 아니면 invalidState()
        const updated = repo.setStatus(application.id, 'CANCELLED');
        // 상태를 CANCELLED로 바꿈, updated에는 status: 'CANCELLED'인 최신 객체가 들어 있음
        repo.addHistory({ applicationId: application.id, actorId: actor.id, action: 'CANCEL', fromStatus: 'PENDING', toStatus: 'CANCELLED' });
        // 어떤 신청을, 누가, 무엇을 했고, 상태가 PENDING에서 CANCELLED로 바뀐것, 생성 시간 이력을 남김
          // reason, causeHistoryId는 null
        return updated;
        // 취소된 신청 객체를 돌려줌
      });
    },

    approve(actor, applicationId) {
      // TODO-03: 담당자·PENDING·정원 검사 → APPROVED + APPROVE 이력.
      // 직접 승인은 운영자가 선택합니다. FIFO는 승인 취소 때의 자동 승급에 적용합니다.
      return transaction(() => {
        const { application, event } = loadForManager(actor, applicationId);
        // 신청이 없으면 404, 운영자가 아니거나 이 행사 담당이 아니면 403
        if (application.status !== 'PENDING') throw invalidState();
        // 대기 중인 신청만 승인 가능, 아니면 invalidState()
        if (repo.approvedCount(event.id) >= event.capacity) throw capacityFull();
          // repo.approvedCount(event.id): 이 행사에서 지금 APPROVED 상태인 사람 수
          // event.capacity: 정원, 승인된 수가 정원 이상이면 capacityFull(), 자리 없으면 승인하지 않고 PENDING으로 남음
        const updated = repo.setStatus(application.id, 'APPROVED');
        // 상태를 APPROVED로 바꾸고, 바뀐 최신 신청 객체를 받음
        repo.addHistory({ applicationId: application.id, actorId: actor.id, action: 'APPROVE', fromStatus: 'PENDING', toStatus: 'APPROVED' });
        // 어떤 신청을, 누가, 무엇을, 원래 상태, 바뀐 상태, 생성 시간
          // reason, causeHistoryId는 null
        return updated;
        // 승인된 신청 객체를 돌려줌
      });
    },

    revoke(actor, applicationId, reason) {
        // actor: 로그인한 사람, applicationId: 취소할 신청 번호, reason: 운영자가 입력한 사유
      // TODO-04: 담당자·APPROVED 검사 → REVOKED + REVOKE 이력.
      // 같은 행사 PENDING 중 created_at ASC, id ASC 첫 1건을 자동 승인합니다.
      // AUTO_APPROVE 이력의 causeHistoryId는 이 요청의 REVOKE 이력 ID입니다.
      // 상태와 이력의 부분 저장을 막고, 거부·오류 시 전체를 되돌리세요.
      // 반환: {revoked: 신청 객체, promoted: 신청 객체 또는 null}.
      return transaction(() => {
        const { application, event } = loadForManager(actor, applicationId);
        // 신청이 없으면 404, 담당 운영자가 아니면 403
        if (application.status !== 'APPROVED') throw invalidState();
        // 승인된 신청만 승인 취소 가능, 아니면 409

        // 1. 승인 취소
        repo.setStatus(application.id, 'REVOKED');
        // 상태를 APPROVED에서 REVOKED로 바꿈
        const revokeHistoryId = repo.addHistory({
          applicationId: application.id, actorId: actor.id, action: 'REVOKE',
          fromStatus: 'APPROVED', toStatus: 'REVOKED', reason
        });
        // 운영자가 승인을 취소했다는 기록을 남김, 취소한 신청, 승인 취소한 운영자, REVOKE, 승인->승인취소, 운영자가 입력한 사유, 생성 시간

        // 2. 다음 대기자 자동 승급
        const next = repo.nextPending(event.id);
        // 같은 행사에서 대기중이면서 가장 먼저 신청한 1명을 찾음
        let promoted = null;
        // 승급된 사람 변수를 일단 null로 만들고 대기자가 없으면 이 값이 응답에 나감
        if (next) { // 대기자가 있으면 실행
          promoted = repo.setStatus(next.id, 'APPROVED');
          // 그 대기자를 APPROVED로 바꾸고 바뀐 신청 객체를 promoted에 넣음
          repo.addHistory({
            applicationId: next.id, actorId: actor.id, action: 'AUTO_APPROVE',
            fromStatus: 'PENDING', toStatus: 'APPROVED', causeHistoryId: revokeHistoryId
          });
          // 승급된 사람의 신청, 승인 취소한 운영자, 자동 승인, 대기 -> 승인, 위에서 보관한 REVOKE 이력 번호, 생성 시간
        }
        return { revoked: repo.application(application.id), promoted };
        // revoked, promoted를 묶어서 돌려줌
      });
    }
  };
}
