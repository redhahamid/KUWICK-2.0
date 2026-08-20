import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './core/query-client';
import { BrowserRouter } from 'react-router-dom';
import { kuwickTheme } from './design-system/theme';
import { App } from './App';
import './index.css';
// The appointment module's presentation layer (V3). Imported AFTER index.css
// so its scoped rules sit later in the cascade; every selector in it is
// namespaced to appointment-owned classes, so order only matters for the few
// antd component overrides both files could plausibly touch.
import './appointment/appointment-v3.css';

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={kuwickTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
