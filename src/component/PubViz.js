import { useState, useEffect } from 'react';
import { fetchAuthor } from './dblp';
import { useParams } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import { getPublications } from './dblp';
import { PublicationsViz } from './dblpViz';

import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
ChartJS.register(ArcElement, Tooltip, Legend);


export default function PubViz() {
    const [author, setAuthor] = useState(null);

    const pid = useParams()['*'];

    useEffect(() => {
        fetchAuthor(pid)
            .then((author) => {
                setAuthor(author);
            })
            .catch((error) => {
                console.error('Error fetching last publications:', error);
            });
    }, [pid]);

    if (author === null)
        return  (<CircularProgress />)
        ;

    const publications = getPublications(author);
    return <PublicationsViz publications={publications} /> ;
}