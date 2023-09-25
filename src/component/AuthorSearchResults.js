/* eslint-disable react/prop-types */
import { useState } from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye } from '@fortawesome/free-solid-svg-icons';
import { useNavigate } from 'react-router-dom';
import { PubList } from './PubList';

import {
    Dialog,
    DialogContent,
    DialogActions,
    Button,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    CircularProgress,
    Box,
    Divider,
} from '@mui/material';







function AuthorSearchResults({ queryResult, queryStatus }) {
    const [openDialog, setOpenDialog] = useState(false);
    const [selectedItemIndex, setSelectedItemIndex] = useState(null);

    const handleClickOpen = (index) => {
        setOpenDialog(true);
        setSelectedItemIndex(index);
    };

    const handleClose = () => {
        setOpenDialog(false);
        setSelectedItemIndex(null);
    };

    // const pid = queryResult[selectedItemIndex].pid;


    const navigate = useNavigate();
    const gotoPublications = (url) => {
        navigate(`/stats/${url}`);
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
                            <IconButton
                                edge="start"
                                color="inherit"
                                aria-label="preview"
                                onClick={() => handleClickOpen(i)} // Pass the item index
                            >
                                <FontAwesomeIcon icon={faEye} />
                            </IconButton>
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

            {/* Modal Dialog */}
            <Dialog
                open={openDialog}
                onClose={handleClose}
                fullWidth={true}
                maxWidth={'lg'}>
                <DialogContent>
                    {selectedItemIndex != null && <PubList pid={queryResult[selectedItemIndex].pid }/>} 
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose} color="primary">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}

export default AuthorSearchResults;




{/* <Dialog open={openDialog} onClose={handleClose} >
                <DialogTitle style={{ fontWeight: 'bold' }}>{selectedItemIndex !== null && queryResult[selectedItemIndex].author}</DialogTitle>
                <DialogContent>
                    {lastPublications !== null ? (
                        <PublicationsViz publications={lastPublications} />
                    ) : (
                        <p>Loading last publications...</p>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose} color="primary">
                        Close
                    </Button>
                </DialogActions>
            </Dialog> */}