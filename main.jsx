import React from 'react'
import ReactDOM from 'react-dom/client'
import OBMPortal from './App.jsx'

// API key is now handled server-side via Netlify Functions
// No key needed in the browser

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OBMPortal />
  </React.StrictMode>
)
