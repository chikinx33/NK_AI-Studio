# NK_Studio Agent Instructions

Before starting work in this repository, read these files first:

- `.trae/rules/nk-ai-studio.md`
- `docs/prompt-rules.md`

Working rules for this repository:

- Treat `AGENTS.md` itself as the first repository-specific instruction file, then read the files listed above.
- Treat `.trae/rules/nk-ai-studio.md` as the primary project rule document.
- Check for UTF-8 encoding issues and Korean text corruption before making or evaluating changes.
- If text appears garbled, call that out explicitly and avoid assuming the source content is correct.
- When reading Korean text files in the terminal, prefer explicit UTF-8 decoding instead of relying on the shell default.
- On Windows/PowerShell, assume `Get-Content` default output can misrender UTF-8 without BOM; verify with `-Encoding utf8` or byte-level inspection before concluding the file is corrupted.
- If a file displays garbled Korean but raw bytes are valid UTF-8, treat it as a decoding problem first and fix the repository/editor settings before editing content.
- When creating or normalizing Korean text files, prefer UTF-8 with BOM in this repository unless an existing file is already consistently managed another way.
- After any code change, update the app version as required by the project rules.
- After coding work, commit and push the latest testable state unless a concrete blocker prevents it.
- Prefer understanding the root cause of issues before applying localized fixes.

## Imported Claude Cowork project instructions

### 역할 분담
- Cowork: 기획, 웹페이지 일감, Code 에게 전달할 작업 요청서 작성.
  요청서는 한 번에 복사·붙여넣기 가능한 하나의 블록으로 작성한다.
  Cowork 는 저장소 코드를 직접 수정하지 않는다.
- NK(사용자): 컨펌, 승인, 로그인 등 결정적 권한.
- Code: 코딩.
