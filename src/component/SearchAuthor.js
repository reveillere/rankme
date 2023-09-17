import '../App.css';
import AuthorSearchForm from './AuthorSearchForm';
import AuthorSearchResults from './AuthorSearchResults'
import { useState } from 'react';


function SearchAuthor() {
  const [queryResult, setQueryResult] = useState([]);
  const [queryStatus, setQueryStatus] = useState('ready');
  
  return (
    <div className='App'>
      <h1>Search author on DBLP</h1>
      <AuthorSearchForm setResult={setQueryResult} setStatus={setQueryStatus} />
      <AuthorSearchResults queryResult={queryResult} queryStatus={queryStatus} />
    </div>
  );
}

export default SearchAuthor;