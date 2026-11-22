(async () => {
  const r = await fetch('https://leetcode.cn/api/problems/all/', { credentials: 'include' });
  const j = await r.json();
  const cookies = document.cookie;
  return {
    user: j.user_name,
    numSolved: j.num_solved,
    numTotal: j.num_total,
    cookies: cookies.split('; ').map((c) => c.split('=')[0]),
    title: document.title,
  };
})()
