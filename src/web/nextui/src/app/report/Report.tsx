'use client';

import React, { useState } from 'react';
import { getApiBaseUrl } from '@/api';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  Button,
  Modal,
  Box,
  Typography,
  Tooltip,
  Chip,
  Stack,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import Card from '@mui/material/Card';
import Container from '@mui/material/Container';
import type { ResultsFile, SharedResults } from '../eval/types';
import Overview from './Overview';
import ReportSettingsDialogButton from './ReportSettingsDialogButton';
import RiskCategories from './RiskCategories';
import TestSuites from './TestSuites';
import { categoryAliases, categoryAliasesReverse } from './constants';
import './Report.css';

interface ProviderPromptData {
  provider: string;
  prompt: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

const ProviderPromptSelector: React.FC<{
  data: ProviderPromptData[];
  selectedProvider: string;
  selectedPromptIndex: number;
  onSelect: (provider: string, prompt: string) => void;
}> = ({ data, selectedProvider, selectedPromptIndex, onSelect }) => {
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
          <Typography variant="h4" component="h2" gutterBottom>
            Select Provider & Prompt
          </Typography>
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

const App: React.FC = () => {
  const [evalId, setEvalId] = React.useState<string | null>(null);
  const [evalData, setEvalData] = React.useState<ResultsFile | null>(null);
  const [selectedProvider, setSelectedProvider] = React.useState<string>('');
  const [selectedPromptIndex, setSelectedPromptIndex] = React.useState<number>(0);
  const [providerPromptData, setProviderPromptData] = React.useState<ProviderPromptData[]>([]);

  React.useEffect(() => {
    const fetchEvalById = async (id: string) => {
      const resp = await fetch(`${await getApiBaseUrl()}/api/results/${id}`, {
        cache: 'no-store',
      });
      const body = (await resp.json()) as SharedResults;
      setEvalData(body.data);
    };

    const searchParams = new URLSearchParams(window.location.search);
    if (!searchParams) {
      return;
    }
    const evalId = searchParams.get('evalId');
    const provider = searchParams.get('provider');
    const promptIndex = searchParams.get('promptIndex');

    if (evalId) {
      setEvalId(evalId);
      fetchEvalById(evalId);
    }

    if (provider) {
      setSelectedProvider(provider);
    }

    if (promptIndex) {
      const index = parseInt(promptIndex, 10);
      if (!isNaN(index)) {
        setSelectedPromptIndex(index);
      }
    }
  }, []);

  React.useEffect(() => {
    if (selectedProvider && selectedPromptIndex !== null) {
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set('provider', selectedProvider);
      searchParams.set('promptIndex', selectedPromptIndex.toString());
      window.history.replaceState(null, '', `?${searchParams.toString()}`);
    }
  }, [selectedProvider, selectedPromptIndex]);

  React.useEffect(() => {
    document.title = `Report: ${evalData?.config.description || evalId || 'Red Team'} | promptfoo`;
  }, [evalData, evalId]);

  React.useEffect(() => {
    if (evalData) {
      // Process evalData to create providerPromptData
      // This is a placeholder implementation - you'll need to adjust based on your actual data structure
      const newData: ProviderPromptData[] = evalData.results.table.head.prompts.map((prompt) => ({
        provider: prompt.provider,
        prompt: prompt.raw,
        critical: Math.floor(Math.random() * 10), // Replace with actual data
        high: Math.floor(Math.random() * 20),
        medium: Math.floor(Math.random() * 30),
        low: Math.floor(Math.random() * 40),
      }));
      setProviderPromptData(newData);
      if (newData.length > 0) {
        setSelectedProvider(newData[0].provider);
        setSelectedPromptIndex(0);
      }
    }
  }, [evalData]);

  const handleProviderPromptSelect = (provider: string, prompt: string) => {
    setSelectedProvider(provider);
    const index = providerPromptData.findIndex(
      (item) => item.provider === provider && item.prompt === prompt,
    );
    if (index !== -1) {
      setSelectedPromptIndex(index);
    }
  };

  if (!evalData || !evalId) {
    return <Box sx={{ width: '100%', textAlign: 'center' }}>Loading...</Box>;
  }

  const prompts = evalData.results.table.head.prompts;
  const currentPrompt = prompts[selectedPromptIndex];
  const tableData = evalData.results.table.body;

  const truncateText = (text: string, maxLength: number) =>
    text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;

  const categoryStats = evalData.results.results.reduce(
    (acc, row) => {
      const harm = row.vars['harmCategory'];
      const metricNames =
        row.gradingResult?.componentResults?.map((result) => result.assertion?.metric) || [];

      const categoriesToCount = [harm, ...metricNames].filter((c) => c);
      for (const category of categoriesToCount) {
        if (typeof category !== 'string') {
          continue;
        }
        const pluginName =
          categoryAliasesReverse[category.split('/')[0] as keyof typeof categoryAliases];
        if (!pluginName) {
          console.log('Unknown harm category:', category);
          return acc;
        }
        const rowPassedModeration = row.gradingResult?.componentResults?.some((result) => {
          const isModeration = result.assertion?.type === 'moderation';
          const isPass = result.pass;
          return isModeration && isPass;
        });
        const rowPassedLlmRubric = row.gradingResult?.componentResults?.some((result) => {
          const isLlmRubric =
            result.assertion?.type === 'llm-rubric' ||
            result.assertion?.type.startsWith('promptfoo:redteam');
          const isPass = result.pass;
          return isLlmRubric && isPass;
        });
        const rowPassedHuman = row.gradingResult?.componentResults?.some((result) => {
          const isHuman = result.assertion?.type === 'human';
          const isPass = result.pass;
          return isHuman && isPass;
        });

        acc[pluginName] = acc[pluginName] || { pass: 0, total: 0, passWithFilter: 0 };
        acc[pluginName].total++;
        if (rowPassedLlmRubric || rowPassedHuman) {
          // Note: We count the row as passed if it passed the LLM rubric or human, even if it failed moderation
          acc[pluginName].pass++;
          acc[pluginName].passWithFilter++;
        } else if (!rowPassedModeration) {
          acc[pluginName].passWithFilter++;
        }
      }
      return acc;
    },
    {} as Record<string, { pass: number; total: number; passWithFilter: number }>,
  );

  return (
    <Container>
      <Stack spacing={4} pb={8} pt={2}>
        <Card className="report-header" sx={{ position: 'relative' }}>
          <ReportSettingsDialogButton />
          <Typography variant="h4">
            <strong>LLM Risk Assessment</strong>
            {evalData.config.description && `: ${evalData.config.description}`}
          </Typography>
          <Typography variant="subtitle1" mb={2}>
            {new Date(evalData.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Typography>
          <Box className="report-details">
            <ProviderPromptSelector
              data={providerPromptData}
              selectedProvider={selectedProvider}
              selectedPromptIndex={selectedPromptIndex}
              onSelect={handleProviderPromptSelect}
            />
            <Stack direction="row" spacing={1} mt={2} flexWrap="wrap">
              <Chip
                size="small"
                label={
                  <>
                    <strong>Dataset:</strong> {tableData.length} probes
                  </>
                }
              />
              <Chip
                size="small"
                label={
                  <>
                    <strong>Model:</strong> {selectedProvider}
                  </>
                }
              />
              <Tooltip
                title={currentPrompt.raw}
                arrow
                placement="bottom"
                enterDelay={500}
                leaveDelay={200}
              >
                <Chip
                  size="small"
                  label={
                    <>
                      <strong>Prompt:</strong> {truncateText(currentPrompt.raw, 30)}
                    </>
                  }
                  sx={{ cursor: 'pointer' }}
                />
              </Tooltip>
            </Stack>
          </Box>
        </Card>
        <Overview categoryStats={categoryStats} />
        <RiskCategories categoryStats={categoryStats} />
        <TestSuites evalId={evalId} categoryStats={categoryStats} />
      </Stack>
    </Container>
  );
};

export default App;
