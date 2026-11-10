import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DemoShowcase } from './pages/DemoShowcase'
import './styles.css'
import './interactions.css'
import './demo-showcase.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{new URLSearchParams(window.location.search).get('showcase') === '1' ? <DemoShowcase /> : <App />}</React.StrictMode>,
)
