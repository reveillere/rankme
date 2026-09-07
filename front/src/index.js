import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.js'
import AdminDashboard from './component/AdminDashboard.js'
import { FilterSettingsProvider } from './FilterSettingsContext.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.Fragment>
    <BrowserRouter>
      <FilterSettingsProvider>
        <Routes>
          {/* Not a feature for regular users, so it sits outside App's tab
              shell/path-matching entirely rather than becoming a tab type. */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="*" element={<App />} />
        </Routes>
      </FilterSettingsProvider>
    </BrowserRouter>
  </React.Fragment>,
)
