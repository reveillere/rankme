import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.js'
import { FilterSettingsProvider } from './FilterSettingsContext.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.Fragment>
    <BrowserRouter>
      <FilterSettingsProvider>
        <App />
      </FilterSettingsProvider>
    </BrowserRouter>
  </React.Fragment>,
)
