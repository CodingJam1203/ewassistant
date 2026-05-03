export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 bg-white rounded-lg shadow-sm border border-gray-100 my-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8 pb-4 border-b">이용약관</h1>
      <div className="prose prose-blue max-w-none text-gray-700 space-y-6">
        <p className="text-lg font-medium">NHR 출퇴근보고 시스템 이용약관</p>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제1조 목적</h2>
          <p>본 약관은 NHR 내부 임직원의 출퇴근보고, 근무상태 확인, 근태관리 및 관련 운영 업무를 위해 제공되는 내부 업무용 서비스의 이용 조건과 절차를 정하는 것을 목적으로 합니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제2조 서비스의 성격</h2>
          <p>본 서비스는 NHR 내부 임직원 및 회사가 승인한 사용자만 사용할 수 있는 내부 업무용 시스템입니다.</p>
          <p>외부인의 사용은 허용되지 않으며, 승인되지 않은 계정은 관리자 승인 전까지 이용이 제한될 수 있습니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제3조 계정 및 이용 권한</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>사용자는 회사가 승인한 계정으로만 서비스를 이용할 수 있습니다.</li>
            <li>Google 로그인 등 인증 수단을 통해 접속할 수 있습니다.</li>
            <li>사전에 등록되지 않은 계정은 잠금 상태로 생성될 수 있으며, 관리자의 승인 후 이용 가능합니다.</li>
            <li>관리자는 계정의 본부, 팀, 이름, 권한, 활성 상태를 관리할 수 있습니다.</li>
            <li>사용자는 본인의 계정을 타인에게 양도하거나 공유할 수 없습니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제4조 서비스 주요 기능</h2>
          <p>본 서비스는 다음 기능을 제공합니다.</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>출퇴근보고 입력</li>
            <li>내 제출 내역 조회</li>
            <li>전체 제출 내역 조회</li>
            <li>출퇴근보고 수정 및 삭제</li>
            <li>팀원 근무상태 확인</li>
            <li>출근, 퇴근, 휴게, 근무지 상태 표시</li>
            <li>관리자 계정 관리</li>
            <li>내부 알림 및 공지</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제5조 사용자의 의무</h2>
          <p>사용자는 다음 사항을 준수해야 합니다.</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>출퇴근보고 내용을 사실에 맞게 입력해야 합니다.</li>
            <li>타인의 계정 또는 정보를 무단으로 사용해서는 안 됩니다.</li>
            <li>허위 정보 입력, 임의 조작, 부정 사용을 해서는 안 됩니다.</li>
            <li>서비스 내 개인정보 또는 근태 정보를 외부에 무단 공유해서는 안 됩니다.</li>
            <li>회사의 보안 및 운영 정책을 준수해야 합니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제6조 관리자의 권한</h2>
          <p>관리자는 서비스 운영을 위해 다음 권한을 가질 수 있습니다.</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>계정 승인 및 잠금 해제</li>
            <li>계정 비활성화</li>
            <li>본부, 팀, 이름, 권한 설정</li>
            <li>전체 제출 내역 조회</li>
            <li>제출 내역 수정 및 삭제 관리</li>
            <li>서비스 공지 등록</li>
            <li>시스템 오류 및 이용 이력 확인</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제7조 제출 내역의 수정 및 삭제</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>사용자는 본인이 제출한 출퇴근보고를 수정 또는 삭제할 수 있습니다.</li>
            <li>관리자는 운영상 필요한 경우 전체 제출 내역을 수정 또는 삭제할 수 있습니다.</li>
            <li>삭제는 즉시 완전 삭제가 아니라 soft delete 방식으로 처리될 수 있습니다.</li>
            <li>수정 및 삭제 이력은 시스템에 기록될 수 있습니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제8조 서비스 이용 제한</h2>
          <p>회사는 다음의 경우 서비스 이용을 제한할 수 있습니다.</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>승인되지 않은 계정으로 접속한 경우</li>
            <li>퇴사자 또는 이용 권한이 없는 자가 접속한 경우</li>
            <li>허위 정보 입력 또는 부정 사용이 확인된 경우</li>
            <li>보안상 위험이 있다고 판단되는 경우</li>
            <li>회사 운영 정책에 위반되는 경우</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제9조 서비스 변경 및 중단</h2>
          <p>회사는 업무상 필요, 시스템 점검, 보안 문제, 기능 개선 등을 위해 서비스의 전부 또는 일부를 변경하거나 중단할 수 있습니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제10조 책임 제한</h2>
          <p>본 서비스는 내부 업무 편의를 위한 보조 시스템입니다.</p>
          <p>사용자는 입력 내용의 정확성에 책임이 있으며, 시스템 오류 또는 누락이 발견될 경우 관리자에게 즉시 알려야 합니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">제11조 약관 변경</h2>
          <p>회사는 관련 법령, 내부 정책, 서비스 기능 변경에 따라 본 약관을 변경할 수 있습니다.</p>
          <p>약관이 변경되는 경우 서비스 내 공지 또는 재동의 절차를 통해 안내합니다.</p>
        </section>

        <p className="mt-8 pt-8 border-t text-sm text-gray-500">
          시행일: 2026년 5월 1일
        </p>
      </div>
    </div>
  )
}
