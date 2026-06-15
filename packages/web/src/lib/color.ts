/** 라벨 값 → 안정적인 색(해시 기반 HSL). 같은 값은 항상 같은 색. */
export function labelColor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 58%)`;
}
