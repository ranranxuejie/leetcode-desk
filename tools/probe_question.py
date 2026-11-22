import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lcgql import gql

Q = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    translatedContent
    difficulty
    topicTags { nameTranslated }
    hints
    exampleTestcases
  }
}
"""
r = gql(Q, {"titleSlug": "longest-substring-without-repeating-characters"})
print(json.dumps(r, ensure_ascii=False)[:1500])
