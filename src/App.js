import './App.css'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import SearchAuthor from './component/SearchAuthor'
import PubList from './component/PubList'
import PubViz from './component/PubViz' 
import Test from './Test'

function App() {
  

  return (
    <Router>
      <div>
      <Routes>
          <Route path="/" element={<SearchAuthor />} />
          <Route path="/publications/*" element={<PubList />} />
          <Route path="/stats/*" element={<PubViz />} />
          <Route path="/test/" element={<Test />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
