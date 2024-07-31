'use client';

import React, { useState } from 'react';
import { getApiBaseUrl } from '@/api';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  Button,
  Modal,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Tooltip,
} from '@mui/material';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
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
  selectedPrompt: string;
  onSelect: (provider: string, prompt: string) => void;
}> = ({ data, selectedProvider, selectedPrompt, onSelect }) => {
  const [open, setOpen] = useState(false);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const handleSelect = (provider: string, prompt: string) => {
    onSelect(provider, prompt);
    handleClose();
  };

  return (
    <>
      <Button onClick={handleOpen} startIcon={<SettingsIcon />}>
        Select Provider & Prompt
      </Button>
      <Modal open={open} onClose={handleClose} aria-labelledby="provider-prompt-selector">
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '80%',
            maxWidth: 800,
            bgcolor: 'background.paper',
            boxShadow: 24,
            p: 4,
            maxHeight: '80vh',
            overflow: 'auto',
          }}
        >
          <Typography id="provider-prompt-selector" variant="h6" component="h2" gutterBottom>
            Select Provider & Prompt
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Provider</TableCell>
                  <TableCell>Prompt</TableCell>
                  <TableCell align="right">Critical</TableCell>
                  <TableCell align="right">High</TableCell>
                  <TableCell align="right">Medium</TableCell>
                  <TableCell align="right">Low</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((row, index) => (
                  <TableRow
                    key={index}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { backgroundColor: 'action.hover' },
                      backgroundColor:
                        row.provider === selectedProvider && row.prompt === selectedPrompt
                          ? 'action.selected'
                          : 'inherit',
                    }}
                    onClick={() => handleSelect(row.provider, row.prompt)}
                  >
                    <TableCell>{row.provider}</TableCell>
                    <TableCell>
                      <Tooltip title={row.prompt} arrow>
                        <span>{row.prompt.substring(0, 30)}...</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">{row.critical}</TableCell>
                    <TableCell align="right">{row.high}</TableCell>
                    <TableCell align="right">{row.medium}</TableCell>
                    <TableCell align="right">{row.low}</TableCell>
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
  const [selectedPrompt, setSelectedPrompt] = React.useState<string>('');
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
    if (evalId) {
      setEvalId(evalId);
      fetchEvalById(evalId);
    }
  }, []);

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
        setSelectedPrompt(newData[0].prompt);
        setSelectedPromptIndex(0);
      }
    }
  }, [evalData]);

  const handleProviderPromptSelect = (provider: string, prompt: string) => {
    setSelectedProvider(provider);
    setSelectedPrompt(prompt);
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
              selectedPrompt={selectedPrompt}
              onSelect={handleProviderPromptSelect}
            />
            <Chip
              size="small"
              label={
                <>
                  <strong>Dataset:</strong> {tableData.length} probes
                </>
              }
            />
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
