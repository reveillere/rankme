/* eslint-disable react/prop-types */

import { useNavigate } from 'react-router-dom';


import {
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    CircularProgress,
    Box,
    Divider,
} from '@mui/material';







function AuthorSearchResults({ queryResult, queryStatus }) {
    

    const navigate = useNavigate();
    const gotoPublications = (url) => {
        navigate(`/author/${url}`);
    };

    const Results = () => {
        if (queryResult.length !== 0) {
            const listItems = queryResult.map((elt, i) => (
                <div key={i}>
                    <ListItem disablePadding>
                        <ListItemButton>
                            <div onClick={() => gotoPublications(elt.pid)} style={{ minWidth: '500px', textDecoration: 'none' }}>
                                <ListItemText
                                    primary={<span style={{ fontWeight: 'bold' }}>{elt.author}</span>}
                                    secondary={<span style={{ fontStyle: 'italic' }}>{elt.affiliation}</span>}
                                />
                            </div>
                        </ListItemButton>
                    </ListItem>
                    <Divider />
                </div>
            ));

            return <List>{listItems}</List>;
        } else return <div>No result!</div>;
    };


    return (
        <div>
            {queryStatus === 'pending' && (
                <Box style={{ display: 'flex', justifyContent: 'center' }}>
                    <CircularProgress />
                </Box>
            )}
            {queryStatus === 'resolved' && <Results />}
        </div>
    );
}

export default AuthorSearchResults;
