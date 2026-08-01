import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { StockLevelsPage } from './StockLevelsPage';
import { LowStockPage } from './LowStockPage';
import { NearExpiryPage } from './NearExpiryPage';
import { NegativeStockPage } from './NegativeStockPage';

const TAB_KEYS = ['all', 'low', 'near-expiry', 'negative'] as const;
type TabKey = (typeof TAB_KEYS)[number];

// M2 (owner-approved) — the four stock views were four sidebar entries
// rendering four filtered views of the same data. One page, four tabs;
// each tab renders the existing page component untouched (their header
// rows double as the per-view toolbars — Stock In, thresholds, reorder —
// so nothing is lost by embedding). Old routes redirect here with the
// matching ?tab= (App.tsx).
export function StockHealthPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: TabKey = TAB_KEYS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'all';

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(key) => setSearchParams(key === 'all' ? {} : { tab: key }, { replace: true })}
      items={[
        { key: 'all', label: 'All Stock', children: <StockLevelsPage /> },
        { key: 'low', label: 'Low Stock', children: <LowStockPage /> },
        { key: 'near-expiry', label: 'Near Expiry', children: <NearExpiryPage /> },
        { key: 'negative', label: 'Negative Stock', children: <NegativeStockPage /> },
      ]}
    />
  );
}
