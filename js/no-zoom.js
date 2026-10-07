// 아이폰에서 버튼을 빠르게 두 번 이상 누르면 화면이 확대되는 문제를 막는다.
//
// CSS 의 touch-action: manipulation 만으로는 부족했다. 누를 때마다 버튼을 새로 그리기 때문에
// 두 번째 탭이 "새 버튼" 위에 떨어지고, iOS 가 이를 두 번 탭 확대로 처리하는 경우가 있다.
//
// 그래서 직전 탭과 350ms 안에 들어온 탭은 브라우저 기본 동작(확대)을 막고,
// 대신 그 자리의 버튼을 직접 눌러 준다. 횟수는 그대로 올라가고 화면은 확대되지 않는다.
// 글자 입력칸은 건드리지 않는다 (커서 이동·글자 선택이 막히면 안 된다).

const DOUBLE_TAP_MS = 350;
const TYPING = 'input, textarea, select, [contenteditable="true"]';

export function preventDoubleTapZoom(doc = document) {
  let lastEnd = 0;
  doc.addEventListener('touchend', (e) => {
    const now = Date.now();
    const quick = now - lastEnd <= DOUBLE_TAP_MS;
    lastEnd = now;
    if (!quick || e.touches.length > 0) return;      // 두 손가락 확대는 그대로 둔다
    if (e.target.closest?.(TYPING)) return;

    e.preventDefault();                               // 확대를 막는다 (클릭도 함께 취소된다)
    const target = e.target.closest?.('button, [role="button"], a, label, .bar') ?? e.target;
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, { passive: false });
}
