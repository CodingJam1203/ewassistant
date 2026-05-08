export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 bg-surface rounded-lg shadow-sm border border-border my-8">
      <h1 className="text-3xl font-bold text-text-primary mb-8 pb-4 border-b">개인정보 처리방침</h1>
      <div className="max-w-none leading-relaxed text-text-primary space-y-6">
        <p className="text-lg font-medium">NHR 출퇴근보고 시스템 개인정보 처리방침</p>
        <p>NHR은 내부 임직원의 출퇴근보고, 근무상태 확인, 근태 관리 및 관련 운영 업무를 위해 필요한 최소한의 개인정보를 처리합니다.</p>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">1. 개인정보의 처리 목적</h2>
          <p>회사는 다음의 목적을 위해 개인정보를 처리합니다.</p>
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
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">2. 처리하는 개인정보 항목</h2>
          <p>회사는 다음의 개인정보를 처리할 수 있습니다.</p>
          
          <h3 className="text-lg font-semibold mt-4 mb-2">필수 항목:</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>이메일, 이름, 본부, 팀, 계정 권한, 계정 활성/잠금 상태</li>
            <li>출퇴근보고 제출 내용 (근무일, 출퇴근 예정시간, 휴게시간, EW 시작/종료시간, 근무장소, 근무내용 등)</li>
            <li>출근/퇴근/휴게/근무지 변경 상태값</li>
            <li>제출, 수정, 삭제 일시 및 수정자/삭제자 정보</li>
          </ul>

          <h3 className="text-lg font-semibold mt-4 mb-2">자동 생성 또는 시스템 처리 항목:</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>로그인 일시, 최근 제출일, 계정 생성일</li>
            <li>상태 변경 이력, 접속 관련 로그, 오류 로그</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">3. 개인정보의 처리 및 보유 기간</h2>
          <p>회사는 개인정보를 내부 근태관리 및 인사노무 운영 목적 달성에 필요한 기간 동안 보유합니다.</p>
          <p>원칙적으로 임직원의 재직 기간 동안 보유하며, 퇴사 또는 계정 비활성화 후에도 관련 법령, 내부 감사, 노무 분쟁 대응, 근태 기록 확인을 위해 필요한 기간 동안 보관할 수 있습니다.</p>
          <p>구체적인 보유 기간은 회사의 내부 인사노무 기록 보존 기준에 따릅니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">4. 개인정보의 제3자 제공</h2>
          <p>회사는 원칙적으로 개인정보를 외부 제3자에게 제공하지 않습니다.</p>
          <p>다만 다음의 경우에는 예외적으로 제공될 수 있습니다.</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>정보주체의 별도 동의가 있는 경우</li>
            <li>법령에 따라 제출 의무가 있는 경우</li>
            <li>수사기관, 감독기관 등 적법한 권한을 가진 기관의 요청이 있는 경우</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">5. 개인정보 처리업무의 위탁</h2>
          <p>회사는 서비스 운영을 위해 다음과 같은 외부 서비스를 사용할 수 있습니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Supabase: 계정 및 데이터 저장</li>
            <li>Google OAuth: Google 계정 로그인 인증</li>
            <li>Vercel 또는 기타 호스팅 서비스: 서비스 배포 및 운영</li>
            <li>이메일 또는 알림 발송 서비스: 계정 승인 및 시스템 알림 발송</li>
            <li>Microsoft Teams 등: 내부 알림 연동이 적용되는 경우</li>
          </ul>
          <p className="mt-2 text-sm text-text-muted">위탁 또는 외부 서비스 연동이 추가되는 경우, 회사는 처리방침에 해당 내용을 반영합니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">6. 개인정보의 파기</h2>
          <p>회사는 개인정보 보유 목적이 달성되거나 보유 기간이 경과한 경우 지체 없이 파기합니다.</p>
          <p>전자적 파일 형태의 정보는 복구 및 재생이 불가능한 방법으로 삭제하며, 출력물 등 서면 자료는 분쇄 또는 소각합니다.</p>
          <p>다만 법령 또는 내부 규정에 따라 보존이 필요한 경우에는 해당 기간 동안 별도 보관할 수 있습니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">7. 개인정보의 안전성 확보조치</h2>
          <p>회사는 개인정보 보호를 위해 다음과 같은 조치를 취합니다.</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>관리자 권한 제한 및 비활성 계정 잠금 처리</li>
            <li>사용자별 접근 권한 분리</li>
            <li>본인 제출 내역과 관리자 기능의 접근 제어</li>
            <li>주요 수정·삭제 이력 기록</li>
            <li>데이터베이스 접근 권한 관리</li>
            <li>환경변수 등을 통한 인증정보 보호</li>
            <li>서비스 로그 및 오류 기록 관리</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">8. 정보주체의 권리</h2>
          <p>임직원은 본인의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다.</p>
          <p>다만 출퇴근보고, 근태관리, 인사노무 운영상 보존이 필요한 정보는 관계 법령 및 내부 기준에 따라 일정 기간 보관될 수 있습니다.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">9. 개인정보 보호 담당자</h2>
          <p>개인정보 및 서비스 이용 관련 문의는 아래 담당자에게 문의할 수 있습니다.</p>
          <ul className="list-none pl-0 space-y-1 mt-2">
            <li><strong>담당자:</strong> NHR 내부 관리자</li>
            <li><strong>이메일:</strong> jmkim@nhr.kr</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-text-primary mt-8 mb-4">10. 처리방침의 변경</h2>
          <p>본 개인정보 처리방침은 서비스 운영 정책, 법령 변경, 기능 추가에 따라 변경될 수 있습니다.</p>
          <p>처리방침이 변경되는 경우 서비스 내 공지 또는 재동의 절차를 통해 안내합니다.</p>
        </section>

        <p className="mt-8 pt-8 border-t text-sm text-text-muted">
          시행일: 2026년 5월 1일
        </p>
      </div>
    </div>
  )
}
