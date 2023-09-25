import React from 'react';
import { Dialog, DialogTitle, DialogActions, IconButton, DialogContent, Typography, Button } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

function About({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle style={{ fontWeight: '800'}}>About</DialogTitle>
      <DialogActions style={{ position: 'absolute', right: '8px', top: '8px', padding: '8px' }}>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogActions><DialogContent>
        <Typography variant="body1">
          Rankme is a web application that allows you to search for authors and display their publication records.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

export default About;
