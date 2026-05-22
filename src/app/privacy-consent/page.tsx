export default function PrivacyConsentPage() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 bg-surface rounded-lg shadow-sm border border-border my-8">
      <h1 className="text-3xl font-bold text-text-primary mb-8 pb-4 border-b">개인정보 수집·이용 동의</h1>
      <div className="max-w-none leading-relaxed text-text-primary space-y-6">
        <p>NHR 출퇴근보고 시스템은 아래와 같이 개인정보를 수집·이용하며, 이에 대한 동의를 받습니다.</p>
        <p className="text-sm text-text-muted">
          ※ 본 동의는 개인정보 처리방침(공개·고지 문서)과 별개의 동의 절차입니다.
        </p>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">① 수집 항목</h2>
          <h3 className="text-lg font-semibold mt-4 mb-2">필수 항목</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>이메일, 이름, 본부, 팀, 계정 권한, 계정 활성/잠금 상태</li>
            <li>출퇴근보고 제출 내용 (근무일, 출퇴근 예정시간, 휴게시간, EW 시작/종료시간, 근무장소, 근무내용 등)</li>
            <li>출근/퇴근/휴게/근무지 변경 상태값</li>
            <li>제출, 수정, 삭제 일시 및 수정자/삭제자 정보</li>
          </ul>
          <h3 className="text-lg font-semibold mt-4 mb-2">자동 생성 항목</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>로그인 일시, 최근 제출일, 계정 생성일</li>
            <li>상태 변경 이력, 접속 관련 로그, 오류 로그</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">② 이용 목적</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>임직원 계정 식별 및 서비스 이용 권한 관리</li>
            <li>출퇴근보고 제출 및 조회</li>
            <li>근무일, 근무시간, 휴게시간, 근무장소, 근무상태 관리</li>
            <li>본부/팀 단위 근무 현황 확인</li>
            <li>관리자 승인, 계정 잠금 및 권한 관리</li>
            <li>제출 내역 수정·삭제 이력 관리</li>
            <li>내부 인사노무 및 근태관리 업무 수행</li>
            <li>시스템 오류 확인, 보안 및 부정 이용 방지</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">③ 보유·이용 기간</h2>
          <p>임직원 재직 기간 동안 보유하며, 퇴사 또는 계정 비활성화 후에도 관련 법령·내부 감사·노무 분쟁 대응·근태 기록 확인을 위해 필요한 기간 동안 보관할 수 있습니다.</p>
          <p>구체적인 기간은 회사의 내부 인사노무 기록 보존 기준에 따릅니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">④ 동의 거부 권리 및 불이익</h2>
          <p>귀하는 위 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다.</p>
          <p>다만 위 항목은 출퇴근보고 시스템 이용에 반드시 필요한 필수 정보이므로, 동의를 거부하실 경우 계정 생성 및 서비스(출퇴근보고) 이용이 제한됩니다.</p>
        </section>

        <p className="mt-8 pt-8 border-t text-sm text-text-muted">
          시행일: 2026년 5월 1일
        </p>
      </div>
    </div>
  )
}
