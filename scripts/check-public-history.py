#!/usr/bin/env python3
"""检查完整文件路径历史和公开基线后的全部可达对象，不输出敏感值。"""
import argparse
import ipaddress
import re
import subprocess
import sys

PUBLIC_BASELINE = "9751f074f713f55add71174ebe4066641ad370f4"
PRIVATE_PATHS = (
    ".gitea", "deploy", "tests/deployment", "doc/PORTAINER_DEPLOYMENT.md",
    "scripts/deploy.sh", "scripts/deploy_portainer.py", "scripts/prune-images.sh",
    "config/app-config.json",
)
PRIVATE_NETWORKS = tuple(ipaddress.IPv4Network(value) for value in (
    (0x0A000000, 8), (0xAC100000, 12), (0xC0A80000, 16),
))
EXAMPLE_ADDRESSES = {
    ".".join(("10", "0", "0", "1")): {"src/__tests__/unit/ai/ai-test-route.test.ts", "src/__tests__/unit/ai/models-route.test.ts"},
    ".".join(("172", "30", "108", "211")): {"doc/setup-wsl-network.md"},
    ".".join(("192", "168", "1", "100")): {"doc/HTTPS_SETUP.md", "doc/setup-wsl-network.md", "docker-compose.https.yml"},
    ".".join(("192", "168", "1", "10")): {
        "README.md", "README.en.md", "doc/INSTALL_PACKAGES.md", "src/__tests__/unit/android-app.test.tsx",
        "src/__tests__/integration/initialize.test.ts",
        "packaging/android/app/src/main/res/values/strings.xml",
        "packaging/android/app/src/main/res/values-zh/strings.xml",
    },
}
IPV4 = re.compile(rb"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
PRIVATE_MARKERS = (
    re.compile(rb"\b(?:gitea|portainer|nas)\.(?!example\.)[a-z0-9.-]+\.(?:com|net|io|lan|local)\b", re.I),
    re.compile(rb"@" + rb"(?!agent\.local>)[^<>\s]+\.local>", re.I),
    re.compile(rb"/Users" + rb"/(?!example(?:/|\b)|username(?:/|\b))[^/\s]+/"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
)


def git(*args):
    return subprocess.check_output(["git", *args])


def private_path(path):
    return any(path == item or path.startswith(item + "/") for item in PRIVATE_PATHS) or (
        path.rsplit("/", 1)[-1].startswith(".env") and path != ".env.example"
    )


def inspect_data(data, path):
    if any(pattern.search(data) for pattern in PRIVATE_MARKERS):
        return "私有域名、本机身份、路径或私钥"
    for match in IPV4.finditer(data):
        address = match.group().decode("ascii")
        try:
            ip = ipaddress.IPv4Address(address)
        except ValueError:
            continue
        if any(ip in network for network in PRIVATE_NETWORKS) and path not in EXAMPLE_ADDRESSES.get(address, set()):
            return "未经审阅的内网地址"
    return None


def check(ref):
    git("rev-parse", "--verify", ref + "^{commit}")
    if git("rev-parse", "--is-shallow-repository").strip() == b"true":
        print("公开历史检查要求完整历史；请先 git fetch --unshallow。", file=sys.stderr)
        return 1
    issues = set()
    for entry in git("log", "--format=", "--name-only", "--no-renames", ref).decode().splitlines():
        if private_path(entry):
            issues.add("私有文件历史: " + entry)
    # 固定公开基线早于私有部署；不将上游既有构建产物误报为新引入内容。
    baseline_known = subprocess.run(
        ["git", "merge-base", "--is-ancestor", PUBLIC_BASELINE, ref],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0
    arguments = ["rev-list", "--objects", ref]
    if baseline_known:
        arguments.extend(["--not", PUBLIC_BASELINE])
    objects = {}
    for entry in git(*arguments).splitlines():
        oid, _, path = entry.partition(b" ")
        objects[oid] = path.decode("utf-8", "replace")
    resolved = git("rev-parse", ref).strip()
    if git("cat-file", "-t", resolved.decode()).strip() == b"tag":
        objects[resolved] = "<标签元数据>"
    with subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        for oid, path in objects.items():
            process.stdin.write(oid + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3:
                raise RuntimeError("无法读取 Git 对象")
            data = process.stdout.read(int(header[2]))
            process.stdout.read(1)
            if header[1] not in (b"blob", b"commit", b"tag"):
                continue
            issue = inspect_data(data, path)
            if issue:
                issues.add(f"{issue}: {path or '<提交元数据>'} ({oid.decode()[:12]})")
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("Git 对象检查失败")
    for issue in sorted(issues):
        print(issue, file=sys.stderr)
    if issues:
        print("公开历史检查失败；推送已阻止。", file=sys.stderr)
        return 1
    scope = "公开基线之后的" if baseline_known else "全部"
    print(f"公开历史检查通过：{scope}{len(objects)} 个可达对象；全历史私有文件路径检查通过。")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", nargs="?", default="HEAD")
    args = parser.parse_args()
    sys.exit(check(args.ref))
