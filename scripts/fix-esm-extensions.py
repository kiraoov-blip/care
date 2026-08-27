#!/usr/bin/env python3
"""
tsc로 lib/*.ts + site/src/*.ts를 site/dist/에 컴파일하면, TS 소스가 (프로젝트 관례대로)
확장자 없이 상대경로를 import하기 때문에(예: `from "./tariff"`) 그 컴파일 결과 JS도
확장자 없는 채로 그대로 나온다. Node/tsx는 그걸 알아서 풀어주지만, 브라우저 네이티브
ES 모듈 로더(<script type="module">)는 상대경로 import에 반드시 확장자가 있어야 한다
— 없으면 그 경로를 파일로 못 찾아 즉시 실패한다.

이 스크립트는 site/dist/ 아래 컴파일된 .js 파일들을 훑어서, 확장자가 없는 상대경로
import/export 지정자에만 `.js`를 붙인다. lib/*.ts · site/src/*.ts 소스 자체는 건드리지
않는다(기존에 골든 테스트로 검증된 lib/*.ts의 import 스타일을 그대로 유지하기 위해,
컴파일 산출물만 후처리하는 방식을 택했다). scripts/build-site.sh(또는 package.json의
build:site)가 tsc 다음 단계로 이 스크립트를 돌린다.
"""
import re
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "site" / "dist"

# from "./x" / from '../y' / import "./z"; 형태에서, 확장자가 없는 상대경로만 골라 .js를 붙인다.
PATTERN = re.compile(r"""(from\s+|import\s+)(['"])(\.\.?/[^'"]+?)\2""")


def add_ext(match: re.Match) -> str:
    keyword, quote, path = match.group(1), match.group(2), match.group(3)
    if re.search(r"\.[a-zA-Z0-9]+$", path):  # 이미 확장자가 있으면(.js/.json 등) 그대로 둠
        return match.group(0)
    return f"{keyword}{quote}{path}.js{quote}"


def main() -> None:
    if not DIST.exists():
        print(f"{DIST} 없음 — 먼저 tsc -p tsconfig.site.json 을 실행하세요.", file=sys.stderr)
        sys.exit(1)
    changed = 0
    for path in DIST.rglob("*.js"):
        text = path.read_text(encoding="utf-8")
        fixed = PATTERN.sub(add_ext, text)
        if fixed != text:
            path.write_text(fixed, encoding="utf-8")
            changed += 1
    print(f"확장자 보정 완료: {changed}개 파일 수정")


if __name__ == "__main__":
    main()
