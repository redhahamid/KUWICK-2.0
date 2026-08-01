import { ReactNode, useMemo } from 'react';
import { Grid, Select, Tabs, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';

const { Text, Title } = Typography;

export interface HubItem {
  path: string;
  label: string;
}

export interface HubCategory {
  key: string;
  label: string;
  // Where clicking the main tab lands. Defaults to the first item.
  landing?: string;
  items: HubItem[];
}

interface HubShellProps {
  title: string;
  categories: HubCategory[];
  // Extra element on the right of the context header (e.g. a link back).
  headerExtra?: ReactNode;
}

// M1 layout shell (owner-approved revision of the focused Management
// audit): horizontal main-category tabs + a contextual secondary submenu
// instead of the permanent 220px left sidebar — Management is charts,
// reports, and wide tables, and the sidebar was eating width they need.
// Shared by Management and CMS Settings so both areas navigate the same
// way. Active category/item derive from the current route (exact match),
// so old bookmarks and redirects light up the right tabs automatically.
//
// Mobile (<md): main tabs scroll horizontally (antd keeps the active tab
// in view); the secondary submenu becomes a full-width dropdown — the
// owner's "Option 2", avoiding two crowded rows of tiny tabs.
export function HubShell({ title, categories, headerExtra }: HubShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const { clinicId, clinics } = useClinicFilter();

  const activeCategory = useMemo(
    () => categories.find((category) => category.items.some((item) => item.path === location.pathname)),
    [categories, location.pathname],
  );

  const scopeName = clinicId ? (clinics?.find((clinic) => clinic.id === clinicId)?.name ?? null) : null;

  const secondaryItems = activeCategory?.items ?? [];
  const showSecondary = secondaryItems.length > 1;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ padding: '10px 24px 0', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Title level={4} style={{ margin: 0 }}>
              {title}
            </Title>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Viewing: {scopeName ?? 'All Branches'}
            </Text>
          </div>
          {headerExtra}
        </div>
        <Tabs
          activeKey={activeCategory?.key}
          onChange={(key) => {
            const category = categories.find((c) => c.key === key);
            if (category) navigate(category.landing ?? category.items[0].path);
          }}
          items={categories.map((category) => ({ key: category.key, label: category.label }))}
          size="small"
          tabBarStyle={{ marginBottom: 0 }}
        />
      </div>

      {showSecondary && (
        <div style={{ padding: screens.md ? '0 24px' : '8px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fafafa' }}>
          {screens.md ? (
            <Tabs
              activeKey={location.pathname}
              onChange={(path) => navigate(path)}
              items={secondaryItems.map((item) => ({ key: item.path, label: item.label }))}
              size="small"
              tabBarStyle={{ marginBottom: 0 }}
              tabBarGutter={24}
            />
          ) : (
            <Select
              style={{ width: '100%' }}
              value={secondaryItems.some((item) => item.path === location.pathname) ? location.pathname : undefined}
              onChange={(path) => navigate(path)}
              options={secondaryItems.map((item) => ({ value: item.path, label: item.label }))}
            />
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: screens.md ? '16px 24px 24px' : '12px 16px 24px' }}>
        <Outlet />
      </div>
    </div>
  );
}
