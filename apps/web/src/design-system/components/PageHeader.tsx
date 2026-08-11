import { ReactNode } from 'react';
import { Typography } from 'antd';

const { Title } = Typography;

/**
 * G4.5d6 — one page header, because twenty-three hand-rolled ones broke the
 * same way on a phone.
 *
 * Every list page opened with the same idiom:
 *
 *   <Space style={{ width: '100%', justifyContent: 'space-between' }}>
 *     <Title level={4}>Appointments</Title>
 *     <Space><Button/><Button/></Space>
 *   </Space>
 *
 * antd's `Space` is `inline-flex` with `flex-wrap: nowrap`, and its items do
 * not shrink evenly: the buttons hold their intrinsic width and the title
 * absorbs the whole deficit. On an iPhone that measured 22px of title against
 * 414px of demand, so "Appointments" wrapped to NINE lines — one letter each.
 * That is the "page titles wrapping vertically" from UAT, and it was never a
 * font-size problem.
 *
 * The rule here is that the TITLE wins and the ACTIONS move. The title block
 * asks for a real minimum width, so when the actions no longer fit beside it
 * they wrap to their own row instead of crushing the heading. On a desktop
 * nothing changes: there is room for both, and they sit on one line with the
 * actions to the right.
 */
export interface PageHeaderProps {
  title: ReactNode;
  /** A quiet second line — a count, a scope, a caveat. */
  subtitle?: ReactNode;
  /** Buttons, filters, view switches. Wraps below the title when narrow. */
  extra?: ReactNode;
  /** Rendered between the title and the actions, e.g. a status chip. */
  badge?: ReactNode;
  className?: string;
  level?: 3 | 4 | 5;
}

export function PageHeader({ title, subtitle, extra, badge, className, level = 4 }: PageHeaderProps) {
  return (
    <div className={`kw-page-header${className ? ` ${className}` : ''}`}>
      <div className="kw-page-header-heading">
        <Title level={level} style={{ margin: 0 }} className="kw-page-title">
          {title}
        </Title>
        {badge}
      </div>
      {subtitle && <div className="kw-page-header-subtitle">{subtitle}</div>}
      {extra && <div className="kw-page-header-actions">{extra}</div>}
    </div>
  );
}
