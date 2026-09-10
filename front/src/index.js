import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.js'
import { LoadingSpinner } from './component/LoadingSpinner.js'
import { FilterSettingsProvider } from './FilterSettingsContext.js'
import './index.css'

// Lazy: this pulls in the admin dashboard's own code (and, transitively,
// anything only it needs) as a separate chunk, so the ~100% of visitors who
// never hit /admin don't pay for it in the main bundle.
const AdminDashboard = React.lazy(() => import('./component/AdminDashboard.js'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.Fragment>
    <BrowserRouter>
      <FilterSettingsProvider>
        <Routes>
          {/* Not a feature for regular users, so it sits outside App's tab
              shell/path-matching entirely rather than becoming a tab type. */}
          <Route path="/admin" element={
            <Suspense fallback={<LoadingSpinner />}>
              <AdminDashboard />
            </Suspense>
          } />
          <Route path="*" element={<App />} />
        </Routes>
      </FilterSettingsProvider>
    </BrowserRouter>
  </React.Fragment>,
)
