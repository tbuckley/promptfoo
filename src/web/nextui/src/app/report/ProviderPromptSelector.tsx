import React, { useState } from 'react';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  Button,
  Modal,
  Box,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';

export interface ProviderPromptData {
  provider: string;
  prompt: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface ProviderPromptSelectorProps {
  data: ProviderPromptData[];
  selectedProvider: string;
  selectedPromptIndex: number;
  onSelect: (provider: string, prompt: string) => void;
}

const ProviderPromptSelector: React.FC<ProviderPromptSelectorProps> = ({
  data,
  selectedProvider,
  selectedPromptIndex,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const handleSelect = (provider: string, prompt: string) => {
    onSelect(provider, prompt);
    handleClose();
  };

  const filteredData = data.filter(
    (item) =>
      item.provider.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.prompt.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <>
      <Button onClick={handleOpen} startIcon={<SettingsIcon />}>
        Select Provider & Prompt
      </Button>
      <Modal open={open} onClose={handleClose}>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '90%',
            maxWidth: 1000,
            maxHeight: '90vh',
            bgcolor: 'background.paper',
            boxShadow: 24,
            p: 4,
            borderRadius: 2,
            overflow: 'auto',
          }}
        >
          <TextField
            fullWidth
            variant="outlined"
            placeholder="Search providers or prompts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Provider</TableCell>
                  <TableCell>Prompt</TableCell>
                  <TableCell align="center">Critical</TableCell>
                  <TableCell align="center">High</TableCell>
                  <TableCell align="center">Medium</TableCell>
                  <TableCell align="center">Low</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredData.map((item, index) => (
                  <TableRow
                    key={index}
                    onClick={() => handleSelect(item.provider, item.prompt)}
                    selected={index === selectedPromptIndex && item.provider === selectedProvider}
                    hover
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>{item.provider}</TableCell>
                    <TableCell>
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                        {item.prompt}
                      </pre>
                    </TableCell>
                    <TableCell align="center">{item.critical}</TableCell>
                    <TableCell align="center">{item.high}</TableCell>
                    <TableCell align="center">{item.medium}</TableCell>
                    <TableCell align="center">{item.low}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Modal>
    </>
  );
};

export default ProviderPromptSelector;
