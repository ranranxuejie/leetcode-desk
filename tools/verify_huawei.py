import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lcgql import gql

Q = """
query favoriteDetailV2($favoriteSlug: String!) {
  favoriteDetailV2(favoriteSlug: $favoriteSlug) {
    name questionNumber favoriteLockStatus favoriteType collectCount
  }
}
"""
for slug in ("huawei", "huawei-od", "hua-wei-yun-2", "hwhs", "huaweizhaopin", "eureka-huawei"):
    print(slug, json.dumps(gql(Q, {"favoriteSlug": slug}), ensure_ascii=False))

Q2 = """
query interviewSearchCompanyCards($in: InterviewSearchCompanyCardsIn!) {
  interviewSearchCompanyCards(in: $in) {
    companyTag { name questionCount followerCount isVerified }
    isPremiumOnly
  }
}
"""
print("search:", json.dumps(gql(Q2, {"in": {"keyWords": "华为"}}, endpoint="noj"), ensure_ascii=False)[:800])
