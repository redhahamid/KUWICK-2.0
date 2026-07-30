import { Route, Routes } from 'react-router-dom';
import { Typography } from 'antd';
import { AppLayout } from './design-system/components/AppLayout';

const { Title, Paragraph } = Typography;

function PlaceholderPage() {
  return (
    <>
      <Title level={4}>Kuwick 2.0</Title>
      <Paragraph type="secondary">Select a module from the sidebar.</Paragraph>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<PlaceholderPage />} />
      </Route>
    </Routes>
  );
}
