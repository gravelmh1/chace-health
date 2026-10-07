// 걸음·심박수는 화면에서 뺐다(Apple 건강은 바로가기만). 앱이 계산하는 값은 그대로 검증하기 위해
// 페이지 안에서 같은 모듈로 대시보드를 계산해, 예전 화면과 같은 모양의 문자열로 돌려준다.
export async function dashValues(page) {
  return page.evaluate(async () => {
    const q = await import('/js/health-queries.js');
    const t = await import('/js/time.js');
    const d = await q.fetchDashboard();
    const steps = d.steps;
    const mi = Number.isFinite(d.distance?.value) ? (d.distance.value / 1609.344).toFixed(1) : null;
    return {
      steps: steps ? Math.round(steps.value).toLocaleString('en-US') : '—',
      note: !steps ? '기록 없음' : steps.isToday ? (mi ? `${mi} mi 걷기·달리기` : '오늘 현재까지') : `마지막 기록 ${steps.localDate ?? ''}`,
      hr: d.heartRate ? String(Math.round(d.heartRate.value)) : '—',
      hrTime: d.heartRate ? `${t.metricTime(d.heartRate)} 측정` : '기록 없음',
      lean: Number.isFinite(d.renpho?.leanBodyMass?.value) ? String(Number(d.renpho.leanBodyMass.value.toFixed(2))) : '—',
    };
  });
}
