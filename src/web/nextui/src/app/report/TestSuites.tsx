import React from 'react';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/navigation';
import {
  categoryAliases,
  displayNameOverrides,
  riskCategories,
  riskCategorySeverityMap,
  subCategoryDescriptions,
} from './constants';
import './TestSuites.css';

// Add this new component for the gray dash in a circle
const GrayDashCircle: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="#9e9e9e" strokeWidth="2" />
    <line x1="8" y1="12" x2="16" y2="12" stroke="#9e9e9e" strokeWidth="2" />
  </svg>
);

const getSubCategoryStats = (
  categoryStats: Record<
    string,
    { pass: number; total: number; passWithFilter: number; unused: number }
  >,
) => {
  const subCategoryStats = [];
  for (const [category, subCategories] of Object.entries(riskCategories)) {
    for (const subCategory of subCategories) {
      const stats = categoryStats[subCategory] || {
        pass: 0,
        total: 0,
        passWithFilter: 0,
        unused: 0,
      };
      const runTests = stats.total - stats.unused;
      subCategoryStats.push({
        pluginName: subCategory,
        type: categoryAliases[subCategory as keyof typeof categoryAliases] || subCategory,
        description:
          subCategoryDescriptions[subCategory as keyof typeof subCategoryDescriptions] || '',
        passRate: runTests > 0 ? ((stats.pass / runTests) * 100).toFixed(1) + '%' : 'N/A',
        passRateWithFilter:
          runTests > 0 ? ((stats.passWithFilter / runTests) * 100).toFixed(1) + '%' : 'N/A',
        severity:
          riskCategorySeverityMap[subCategory as keyof typeof riskCategorySeverityMap] || 'Unknown',
        unused: stats.unused,
        total: stats.total,
      });
    }
  }
  return subCategoryStats.sort((a, b) => {
    if (a.passRate === 'N/A' && b.passRate === 'N/A') {
      return 0;
    }
    if (a.passRate === 'N/A') {
      return 1;
    }
    if (b.passRate === 'N/A') {
      return -1;
    }
    return parseFloat(a.passRate) - parseFloat(b.passRate);
  });
};

const TestSuites: React.FC<{
  evalId: string;
  categoryStats: Record<
    string,
    { pass: number; total: number; passWithFilter: number; unused: number }
  >;
}> = ({ evalId, categoryStats }) => {
  const router = useRouter();
  const subCategoryStats = getSubCategoryStats(categoryStats);
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = React.useState<'passRate' | 'severity' | 'default'>('default');
  const handleSort = (property: 'passRate' | 'severity') => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom id="table">
        Vulnerabilities and Mitigations
      </Typography>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'passRate'}
                  direction={orderBy === 'passRate' ? order : 'asc'}
                  onClick={() => handleSort('passRate')}
                >
                  Pass rate
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'severity'}
                  direction={orderBy === 'severity' ? order : 'asc'}
                  onClick={() => handleSort('severity')}
                >
                  Severity
                </TableSortLabel>
              </TableCell>
              <TableCell style={{ minWidth: '275px' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {subCategoryStats
              .sort((a, b) => {
                if (orderBy === 'passRate') {
                  if (a.passRate === 'N/A') {
                    return 1;
                  }
                  if (b.passRate === 'N/A') {
                    return -1;
                  }
                  return order === 'asc'
                    ? parseFloat(a.passRate) - parseFloat(b.passRate)
                    : parseFloat(b.passRate) - parseFloat(a.passRate);
                } else if (orderBy === 'severity') {
                  if (a.passRate === 'N/A') {
                    return 1;
                  }
                  if (b.passRate === 'N/A') {
                    return -1;
                  }
                  const severityOrder = {
                    Critical: 4,
                    High: 3,
                    Medium: 2,
                    Low: 1,
                  };
                  return order === 'asc'
                    ? severityOrder[a.severity] - severityOrder[b.severity]
                    : severityOrder[b.severity] - severityOrder[a.severity];
                } else {
                  // Default sort: severity desc tiebroken by pass rate asc, N/A passRate goes to the bottom
                  const severityOrder = {
                    Critical: 4,
                    High: 3,
                    Medium: 2,
                    Low: 1,
                  };
                  if (a.severity === b.severity) {
                    return parseFloat(a.passRate) - parseFloat(b.passRate);
                  } else {
                    return severityOrder[b.severity] - severityOrder[a.severity];
                  }
                }
              })
              .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
              .map((subCategory, index) => {
                let passRateClass = '';
                if (subCategory.passRate !== 'N/A') {
                  const passRate = parseFloat(subCategory.passRate);
                  if (passRate >= 75) {
                    passRateClass = 'pass-high';
                  } else if (passRate >= 50) {
                    passRateClass = 'pass-medium';
                  } else {
                    passRateClass = 'pass-low';
                  }
                }
                return (
                  <TableRow
                    key={index}
                    sx={
                      subCategory.unused === subCategory.total
                        ? {
                            opacity: 0.5,
                            color: 'text.secondary',
                            '& .MuiTableCell-root': { color: 'inherit' },
                          }
                        : {}
                    }
                  >
                    <TableCell>
                      <span style={{ fontWeight: 500 }}>
                        {displayNameOverrides[
                          subCategory.pluginName as keyof typeof displayNameOverrides
                        ] || subCategory.type}
                      </span>
                    </TableCell>
                    <TableCell>{subCategory.description}</TableCell>
                    <TableCell className={passRateClass}>
                      {subCategory.unused === subCategory.total ? (
                        <GrayDashCircle />
                      ) : subCategory.passRate === '100.0%' ? (
                        <CheckCircleIcon color="success" />
                      ) : (
                        <CancelIcon color="error" />
                      )}
                      <strong>
                        {subCategory.unused === subCategory.total
                          ? 'Not run'
                          : subCategory.passRate}
                      </strong>
                      {subCategory.passRateWithFilter !== subCategory.passRate &&
                      subCategory.unused !== subCategory.total ? (
                        <>
                          <br />({subCategory.passRateWithFilter} with mitigation)
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className={`vuln-${subCategory.severity.toLowerCase()}`}>
                      {subCategory.severity}
                    </TableCell>
                    <TableCell style={{ minWidth: 270 }}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => {
                          const searchParams = new URLSearchParams(window.location.search);
                          const evalId = searchParams.get('evalId');
                          window.location.href = `/eval/?evalId=${evalId}&search=${encodeURIComponent(`(var=${subCategory.type}|metric=${subCategory.type})`)}`;
                        }}
                      >
                        View logs
                      </Button>
                      <Tooltip title="Temporarily disabled while in beta, click to contact us to enable">
                        <Button
                          variant="contained"
                          size="small"
                          color="inherit"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            window.location.href =
                              'mailto:inquiries@promptfoo.dev?subject=Promptfoo%20automatic%20vulnerability%20mitigation&body=Hello%20Promptfoo%20Team,%0D%0A%0D%0AI%20am%20interested%20in%20learning%20more%20about%20the%20automatic%20vulnerability%20mitigation%20beta.%20Please%20provide%20me%20with%20more%20details.%0D%0A%0D%0A';
                          }}
                        >
                          Apply mitigation
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
        {subCategoryStats.length > rowsPerPage && (
          <TablePagination
            rowsPerPageOptions={[10, 25, 50]}
            component="div"
            count={subCategoryStats.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        )}
      </TableContainer>
    </Box>
  );
};

export default TestSuites;
