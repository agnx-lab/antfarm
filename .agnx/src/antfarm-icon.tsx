// 场景：Antfarm 面板图标 — 蚂蚁剪影（呼应上游 landing/logo.jpeg）。
import type { ReactElement } from "react";
import Svg, { Ellipse, Path } from "react-native-svg";

export function AntfarmIcon(props: {
  color?: string;
  size?: number;
}): ReactElement {
  const size = props.size ?? 22;
  const color = props.color ?? "#fafafa";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 头 / 胸 / 腹 三节 */}
      <Ellipse cx={17.6} cy={9.6} rx={2.6} ry={2.2} fill={color} />
      <Ellipse cx={12} cy={12.4} rx={2.2} ry={2.6} fill={color} />
      <Ellipse cx={6.4} cy={9.4} rx={3.1} ry={3.3} fill={color} />
      {/* 触角 */}
      <Path
        d="M18.4 7.8c.9-1.4 2-2.2 3-2.5M16.6 7.4c.2-1.6.9-2.6 1.6-3.3"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      {/* 腿 */}
      <Path
        d="M6.2 12.4 3.4 15.6M7.4 12.8l-1.1 4M12 14.6l-2.2 3.6M12.6 10.2l2.1-2.9"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}
