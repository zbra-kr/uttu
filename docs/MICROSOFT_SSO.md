# UTTU 회사 Microsoft 로그인

## 범위와 현재 상태

- 기존 이메일/비밀번호 로그인은 유지한다. 데스크톱/모바일에 회사 Microsoft 로그인 버튼을 추가한다.
- 사용자는 **첫 회사 로그인 시 UTTU 계정 자동 생성**을 선택했다. 신규 계정은 기존 `handle_new_user()`를 통해 `profiles.role = 'viewer'`가 된다. 관리자 역할이나 권한을 Microsoft 클레임에서 복사하지 않는다.
- 같은 **검증된 이메일**로 기존 UTTU 사용자에 연결되는 경우 Supabase의 자동 identity linking을 사용한다. `auth.users.id`, 기존 프로필/역할/저장 데이터는 애플리케이션에서 변경하지 않는다. 이메일이 다르면 자동 병합하지 않는다.
- 저장소에는 별도 활성화/승인 컬럼이 없다. 실환경의 추가 정책은 운영자가 별도로 확인해야 한다. 도메인 트리거의 연결/실행 시점, RLS, 관리자 검사, AI 할당량은 유지한다.
- 로그인 UI와 기존 Supabase OAuth 콜백을 보강한다. 후속 승인된 `01502_microsoft_company_email_domain.sql`은 회사 테넌트 Azure 로그인에 한해 정확한 `@barrelsco.onmicrosoft.com` 주소를 신규 가입 허용 범위에 추가한다. 일반 이메일 가입은 기존 `@bcave.co.kr` 제한을 유지한다. 사용자 병합, 역할/RLS 변경은 포함하지 않으며 비밀은 저장소에 포함하지 않는다.
- `NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED`가 정확히 `true`일 때만 버튼과 서버 액션이 활성화된다. 기본은 비활성이다. 이 플래그는 UI/앱 진입점의 출시 제어이며, Supabase Azure provider 자체의 접근 정책을 대신하지 않는다.

2026-10-01 운영 설정 확인: Supabase Azure provider가 활성화되었고, 회사 테넌트 URL, 운영 Site URL `https://uttu.bcave.ai` 및 `/auth/callback` 허용 주소가 저장되었다. 로그인 UI/콜백 코드는 커밋 `69b40ada7bb18f7210d74a62702cadfcd9cc9dd0`으로 운영에 배포되었다. 실제 테스트에서 Azure 자격 증명 교환은 통과했으며, 기존 DB의 `@bcave.co.kr` 도메인 검사에서 `@barrelsco.onmicrosoft.com` 신규 계정이 차단되어 아래 제한적 예외가 추가 승인되었다. 마이그레이션 적용 및 전체 실계정 로그인 결과는 별도로 검증해야 한다. 수동 identity linking 설정 변경은 필요하지 않다.

## 운영자가 승인 후 설정할 항목

### 1. Microsoft Entra

1. 회사 테넌트의 앱 등록에서 지원 계정 유형을 **이 조직 디렉터리의 계정만(단일 테넌트)**으로 지정한다.
2. 플랫폼은 **Web**, Redirect URI는 다음 Supabase 콜백으로 등록한다. UTTU 콜백과 혼동하지 않는다.
   - `https://ogtrvberttzupxrffpoh.supabase.co/auth/v1/callback`
3. 기본 OIDC `openid email profile` 권한만 사용한다. `openid`는 Supabase가 추가하고 앱은 `email profile`을 요청한다. `profile`은 표시 이름을 받기 위해 승인되었다. Microsoft Graph 디렉터리 API, `offline_access`, 메일함/파일 권한은 요청하지 않는다.
4. Supabase 공식 Azure 가이드에 따라 ID token optional claims에 `email`, `xms_edov`, access token optional claims에 `xms_edov`를 추가한다. 기존 `optionalClaims`는 덮어쓰지 말고 보존한다. **단일 테넌트라도 검증되지 않은 이메일로 기존 UTTU 계정에 연결되지 않는지 반드시 확인한다.**
5. Client ID와 발급한 client secret **Value**를 Supabase Azure provider에 관리자가 직접 입력한다. Secret은 코드, `NEXT_PUBLIC_*`, 채팅, 로그에 넣지 않는다. 만료일과 갱신 담당자를 기록한다.
6. 단일 테넌트에는 초대된 게스트도 있을 수 있다. “회사 직원” 범위를 Entra 사용자/그룹 할당 등 운영 정책으로 확인한다. 필요한 경우 Enterprise application의 assignment requirement를 승인 후 설정하고 직원 그룹만 할당한다. 회사 이메일 문자열만으로 직원 신분을 판단하지 않는다.
7. 기존 Conditional Access/MFA 정책을 유지한다. 구현은 `prompt=login`이나 `prompt=none`을 강제하지 않는다. Windows/Edge의 기존 회사 세션 활용은 장치·브라우저·Entra 정책에 달려 있고, 매번 무입력 로그인을 보장하지 않는다.
8. Entra 사용자 비활성화가 이미 발급된 Supabase 세션을 즉시 끝내지는 않는다. 기존 UTTU 퇴사자 접근 차단/세션 취소 절차를 유지하고 별도 검증한다.

### 2. Supabase

1. 실제 프로젝트가 `ogtrvberttzupxrffpoh`인지 확인하고 Azure provider에 Client ID/Secret을 설정한다.
2. Azure Tenant URL은 **`https://login.microsoftonline.com/<회사-tenant-id>`**로 설정한다. `common` 또는 `consumers`로 두지 않는다.
3. Site URL: `https://uttu.bcave.ai`
4. Redirect URLs에 `https://uttu.bcave.ai/auth/callback`을 확인한다. 앱은 로그인 전 경로를 `next` 쿼리로 전달하므로 쿼리가 있는 콜백도 staging에서 검증한다. 같은 Site URL origin은 Supabase에서 허용되며, 별도 preview/local origin은 필요한 콜백만 허용하고 운영용 광범위 wildcard는 피한다.
5. 첫 로그인 자동 생성을 위해 실제 Allow new users/signups 정책이 허용되는지 확인한다. 기존 `before_user_insert_domain_check` 및 `handle_new_user` 트리거를 유지한다. `01502` 적용 후 일반 이메일 가입은 `@bcave.co.kr`만, 회사 테넌트 Azure 로그인은 추가로 정확한 `@barrelsco.onmicrosoft.com`만 허용한다. 아래 DB 변경 절차와 거부 테스트를 확인한다.
6. 회사 계정의 실제 이메일 클레임이 기존 UTTU 이메일과 일치하는지 확인한다. UPN/별칭 차이로 다른 이메일이 나오면 새 UUID가 생성될 수 있다. 기존 사용자를 삭제하거나 역할을 복사하여 임의로 해결하지 않는다.

### 3. Viewer 환경변수와 출시

```text
NEXT_PUBLIC_APP_URL=https://uttu.bcave.ai
NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED=true
```

기존 `NEXT_PUBLIC_SITE_URL`도 fallback으로 지원하지만 `NEXT_PUBLIC_APP_URL`이 우선이다. production에서는 HTTPS origin이 없거나 path/query/credentials가 포함되면 Microsoft 로그인을 시작하지 않는다. 개발 서버 기본값은 실제 npm script와 같은 `http://localhost:3100`이다. Azure Client ID/Secret은 Viewer에 필요 없다. 공개 변수 변경 후에는 다시 빌드해야 한다.

운영 설정과 배포 승인을 확인한 후 위 플래그를 설정하고 다시 빌드한다. 코드 배포와 provider 활성화는 별도 승인 대상이다. 자동 테스트 통과만으로 아래 실계정 검증까지 완료된 것으로 간주하지 않는다.

### 4. 승인된 회사 Microsoft 도메인 예외

- 먼저 실환경 `check_email_domain()`이 기존 `@bcave.co.kr` 검사와 동일하고, `before_user_insert_domain_check`가 `auth.users`의 `BEFORE INSERT` 전용인지 확인한다.
- Azure Tenant URL은 반드시 `https://login.microsoftonline.com/09cefcf6-a744-4cc2-a8ec-681fe0d1a85a`로 유지한다. `common`/`organizations`/`consumers`로 확대하지 않는다. 테넌트 제한은 Supabase Azure provider가 서명된 ID token의 issuer를 검증해 강제하며, 도메인 문자열 자체가 테넌트 검증을 대신하지 않는다.
- `supabase/migrations/01502_microsoft_company_email_domain.sql`은 기존 함수만 교체한다. Supabase가 신규 사용자 INSERT 전에 설정하는 `raw_app_meta_data.provider = 'azure'`와 정확한 이메일 도메인을 함께 검사한다. 사용자가 수정할 수 있는 `raw_user_meta_data`를 provider 판별에 사용하지 않는다.
- 적용과 `supabase/tests/microsoft_company_email_domain.sql` 실행을 하나의 명시적 `BEGIN`/`COMMIT` 트랜잭션으로 묶는다. 테스트는 TEMP 테이블의 합성 데이터만 사용하며, 실패하면 전체 적용을 롤백한다. 이 테스트를 autocommit 상태로 문장별 실행하지 않는다.
- 기존 함수의 NULL 이메일 처리, INSERT 전용 시점, 역할/프로필/할당량/RLS는 바꾸지 않는다. 다른 테넌트 도메인, 개인 Microsoft 도메인, 하위 도메인·접미사 위조, 일반 이메일 provider의 추가 도메인 가입은 계속 거부한다.
- 기존 `@bcave.co.kr` 사용자와 다른 `@barrelsco.onmicrosoft.com` 이메일은 자동 병합하지 않는다. 새 UUID에는 기존 프로필 트리거의 `viewer` 기본 역할이 적용된다.
- 공급자 데이터 흐름 근거: [Supabase 외부 로그인 계정 생성](https://github.com/supabase/auth/blob/master/internal/api/external.go), [사용자 INSERT 전 app metadata 설정](https://github.com/supabase/auth/blob/master/internal/api/signup.go). 합성 DB 테스트만으로 실제 provider 발급·테넌트 검증이나 실계정 로그인을 증명하지 않는다.

### 5. Entra 표시 이름 수신과 빈 프로필 보완

- Microsoft는 `name` 클레임에 기본 OIDC `profile` scope를 요구한다. 이메일만 요청한 기존 로그인에서는 이름이 비어 있을 수 있다. [Microsoft ID token 클레임](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- 새 Microsoft 로그인에서 Supabase가 Azure `name`을 Auth 사용자/identity의 `full_name`으로 가져온다. 새 사용자 프로필은 기존 `handle_new_user()`로 이름을 받는다.
- 기존 사용자는 다음 Microsoft 인증 완료 시 콜백이 Azure identity의 `full_name`/`name`만 읽어 `profiles.full_name`의 NULL·빈 문자열·공백만 채운다. 수정 전 값을 UPDATE 조건에 포함하여 동시에 저장된 사용자 지정 이름을 덮어쓰지 않는다.
- `display_name` 별칭과 다른 필드, 역할, 이메일, UUID는 바꾸지 않는다. 이름은 표시 전용이고 접근 권한 판단에 사용하지 않는다. 이름이 없을 때 이메일/UPN에서 추측하지 않는다.
- 프로필 쓰기 실패는 로그에 고정된 진단 문구만 남기고 정상 인증을 실패로 바꾸지 않는다. 이름·토큰·provider 응답 원문은 로그에 남기지 않는다.
- 이미 로그인된 세션에는 새 claim이 자동 추가되지 않는다. 실제 Microsoft 재인증 후 Auth 대시보드와 프로필 이름을 확인한다. 테스트를 위해 다른 기기의 세션까지 로그아웃하지 않는다.

## 검증 체크리스트

로컬 자동 검증:

```sh
cd viewer
npm ci
npm run test:auth
npm run test:egress
npm run lint
npx tsc --noEmit
npm run build
```

`test:auth`는 Node 20 이상에서 실제 TypeScript 모듈을 로드하고 Supabase/Next 경계만 mock한다. 실제 provider 구성, 쿠키 저장, Windows 세션, DB trigger/RLS는 아래 staging 확인이 필요하다.

- 플래그 OFF에서 버튼이 숨겨지고 직접 서버 액션 호출도 차단되는지 확인
- 데스크톱/모바일에서 버튼 pending/중복 클릭 방지, 취소 후 재시도, 브라우저 뒤로/앞으로 이동 확인
- 기존 검증된 회사 이메일 계정: 로그인 전후 UUID, 역할, 기존 저장 데이터 동일 확인
- 새 직원: 첫 로그인 성공, profile 1개 생성, role viewer, 기본 할당량/알림 생성 확인
- 비회사 테넌트, 개인 Microsoft 계정, 외부 게스트, 검증되지 않은 이메일을 정책대로 거부하는지 확인
- 관리자 계정은 기존 관리자 권한 유지, 일반 직원은 관리자 API 접근 불가 확인
- `/today?team=finance` 같은 원래 경로 복귀 및 외부/프로토콜 상대 redirect 차단 확인
- 취소, 네트워크 오류, 만료/재사용 PKCE code는 안전한 안내와 함께 로그인 화면으로 복귀하는지 확인
- 기존 비밀번호 로그인 및 이메일 확인 흐름 회귀 확인. 저장소에는 `/reset-password` 페이지가 없으므로 기존 비밀번호 재설정 완료 화면 문제는 이 SSO 변경과 별도로 확인 필요
- 장치 로그인 상태와 MFA/Conditional Access가 적용되는 실 Windows/Edge에서 최종 확인

## 되돌리기

Viewer 플래그를 제거하거나 `false`로 재배포하면 이 버튼/서버 액션이 비활성화된다. provider를 통한 직접 로그인까지 중단하려면 별도 승인 후 Supabase Azure provider도 비활성화해야 한다. 기존 세션/사용자/프로필을 삭제하지 않는다. 이메일/비밀번호 로그인은 계속 유지한다.

DB 도메인 예외를 되돌려야 한다면 별도 승인 후 `supabase/rollbacks/01502_microsoft_company_email_domain.sql`로 기존 함수를 복원한다. 이는 향후 신규 INSERT만 제한하며 이미 생성된 사용자나 세션을 삭제·차단하지 않는다.

## 공식 참고

- [Supabase Azure 로그인, tenant URL, email/xms_edov](https://supabase.com/docs/guides/auth/social-login/auth-azure)
- [Supabase 자동 identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
