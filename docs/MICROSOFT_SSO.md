# UTTU 회사 Microsoft 로그인

## 범위와 현재 상태

- 기존 이메일/비밀번호 로그인은 유지한다. 데스크톱/모바일에 회사 Microsoft 로그인 버튼을 추가한다.
- 사용자는 **첫 회사 로그인 시 UTTU 계정 자동 생성**을 선택했다. 신규 계정은 기존 `handle_new_user()`를 통해 `profiles.role = 'viewer'`가 된다. 관리자 역할이나 권한을 Microsoft 클레임에서 복사하지 않는다.
- 같은 **검증된 이메일**로 기존 UTTU 사용자에 연결되는 경우 Supabase의 자동 identity linking을 사용한다. `auth.users.id`, 기존 프로필/역할/저장 데이터는 애플리케이션에서 변경하지 않는다. 이메일이 다르면 자동 병합하지 않는다.
- 저장소에는 별도 활성화/승인 컬럼이 없다. 실환경의 추가 정책은 운영자가 별도로 확인해야 한다. 기존 도메인 트리거, RLS, 관리자 검사, AI 할당량을 수정하지 않는다.
- 이 변경은 로그인 UI와 기존 Supabase OAuth 콜백을 보강한다. DB 마이그레이션, 사용자 병합, 권한 변경은 포함하지 않는다. 비밀은 저장소에 포함하지 않는다.
- `NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED`가 정확히 `true`일 때만 버튼과 서버 액션이 활성화된다. 기본은 비활성이다. 이 플래그는 UI/앱 진입점의 출시 제어이며, Supabase Azure provider 자체의 접근 정책을 대신하지 않는다.

2026-10-01 운영 설정 확인: Supabase Azure provider가 활성화되었고, 회사 테넌트 URL, 운영 Site URL `https://uttu.bcave.ai` 및 `/auth/callback` 허용 주소가 저장되었다. Microsoft 인증 시작 요청의 `openid email` scope는 확인했지만, 실제 계정의 토큰 교환·기존 계정 연결·신규 프로필 생성은 아직 검증하지 않았다. 코드 반영과 운영 배포는 사용자가 승인했으며, 배포 여부와 실계정 검증 결과는 별도로 확인해야 한다. 수동 identity linking 설정 변경은 필요하지 않다.

## 운영자가 승인 후 설정할 항목

### 1. Microsoft Entra

1. 회사 테넌트의 앱 등록에서 지원 계정 유형을 **이 조직 디렉터리의 계정만(단일 테넌트)**으로 지정한다.
2. 플랫폼은 **Web**, Redirect URI는 다음 Supabase 콜백으로 등록한다. UTTU 콜백과 혼동하지 않는다.
   - `https://ogtrvberttzupxrffpoh.supabase.co/auth/v1/callback`
3. 최소 OIDC/email 로그인에 필요한 권한만 사용한다. 이 구현은 Microsoft Graph 데이터, `offline_access`, 메일/파일 권한을 요청하지 않는다.
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
5. 첫 로그인 자동 생성을 위해 실제 Allow new users/signups 정책이 허용되는지 확인한다. 기존 `before_user_insert_domain_check` 및 `handle_new_user` 트리거가 적용되어 있고, 회사 이메일 도메인 `@bcave.co.kr`만 신규 생성되는지 확인한다. 이 패치에 DB 마이그레이션은 필요하지 않다.
6. 회사 계정의 실제 이메일 클레임이 기존 UTTU 이메일과 일치하는지 확인한다. UPN/별칭 차이로 다른 이메일이 나오면 새 UUID가 생성될 수 있다. 기존 사용자를 삭제하거나 역할을 복사하여 임의로 해결하지 않는다.

### 3. Viewer 환경변수와 출시

```text
NEXT_PUBLIC_APP_URL=https://uttu.bcave.ai
NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED=true
```

기존 `NEXT_PUBLIC_SITE_URL`도 fallback으로 지원하지만 `NEXT_PUBLIC_APP_URL`이 우선이다. production에서는 HTTPS origin이 없거나 path/query/credentials가 포함되면 Microsoft 로그인을 시작하지 않는다. 개발 서버 기본값은 실제 npm script와 같은 `http://localhost:3100`이다. Azure Client ID/Secret은 Viewer에 필요 없다. 공개 변수 변경 후에는 다시 빌드해야 한다.

운영 설정과 배포 승인을 확인한 후 위 플래그를 설정하고 다시 빌드한다. 코드 배포와 provider 활성화는 별도 승인 대상이다. 자동 테스트 통과만으로 아래 실계정 검증까지 완료된 것으로 간주하지 않는다.

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

## 공식 참고

- [Supabase Azure 로그인, tenant URL, email/xms_edov](https://supabase.com/docs/guides/auth/social-login/auth-azure)
- [Supabase 자동 identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
