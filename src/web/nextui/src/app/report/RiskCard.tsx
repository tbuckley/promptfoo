import React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { categoryAliases } from './constants';
import { useReportStore } from './store';
import './RiskCard.css';

const RiskCard: React.FC<{
  title: string;
  subtitle: string;
  totalProbes: number;
  numTestsPassed: number;
  numTestsFailed: number;
  numTestsUnused: number;
  testTypes: { name: string; passed: boolean; percentage: number; unused: number }[];
}> = ({
  title,
  subtitle,
  totalProbes,
  numTestsPassed,
  numTestsFailed,
  numTestsUnused,
  testTypes,
}) => {
  const { showPercentagesOnRiskCards, pluginPassRateThreshold } = useReportStore();
  const runTests = numTestsPassed + numTestsFailed;

  const getStatusColor = (passRate: number) => {
    if (passRate >= 80) {
      return '#34C759';
    } // Apple's green
    if (passRate >= 50) {
      return '#FF9500';
    } // Apple's orange
    return '#FF3B30'; // Apple's red
  };

  return (
    <Card>
      <CardContent className="risk-card-container">
        <Grid container spacing={3}>
          <Grid item xs={12} md={6} style={{ textAlign: 'center' }}>
            <Typography variant="h5" className="risk-card-title">
              {title}
            </Typography>
            <Typography variant="subtitle1" color="textSecondary" mb={2}>
              {subtitle}
            </Typography>
            {runTests > 0 ? (
              <>
                <Box sx={{ position: 'relative', display: 'inline-flex', m: 2 }}>
                  <CircularProgress
                    variant="determinate"
                    value={(numTestsPassed / runTests) * 100}
                    size={80}
                    thickness={4}
                    sx={{ color: getStatusColor((numTestsPassed / runTests) * 100) }}
                  />
                  <Box
                    sx={{
                      top: 0,
                      left: 0,
                      bottom: 0,
                      right: 0,
                      position: 'absolute',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography variant="caption" component="div" color="text.secondary">
                      {`${Math.round((numTestsPassed / runTests) * 100)}%`}
                    </Typography>
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {numTestsPassed} passed, {numTestsFailed} failed
                </Typography>
              </>
            ) : (
              <Typography variant="body1" color="text.secondary" sx={{ m: 2 }}>
                No probes run
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {runTests} of {totalProbes} probes tested
              {numTestsUnused > 0 && ` (${numTestsUnused} unused)`}
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <List dense>
              {testTypes.map((test, index) => (
                <ListItem key={index} disablePadding>
                  <ListItemText
                    primary={categoryAliases[test.name as keyof typeof categoryAliases]}
                    secondary={
                      test.unused ? 'Not tested' : `${Math.round(test.percentage * 100)}% passed`
                    }
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{
                      variant: 'caption',
                      style: {
                        color: test.unused
                          ? 'text.secondary'
                          : getStatusColor(test.percentage * 100),
                      },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default RiskCard;
