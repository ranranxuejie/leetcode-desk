import json, urllib.request, sys

ENDPOINTS = {
    "main": "https://leetcode.cn/graphql/",
    "noj": "https://leetcode.cn/graphql/noj-go/",
}

HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://leetcode.cn",
    "Referer": "https://leetcode.cn/company/huawei/problemset/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}


def gql(query, variables=None, endpoint="main", cookie=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    h = dict(HEADERS)
    if cookie:
        h["Cookie"] = cookie
    req = urllib.request.Request(ENDPOINTS[endpoint], data=payload, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"http_error": e.code, "body": e.read().decode()[:2000]}


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else '{ __typename }'
    ep = sys.argv[2] if len(sys.argv) > 2 else "main"
    print(json.dumps(gql(q, {}, ep), ensure_ascii=False, indent=2)[:6000])
