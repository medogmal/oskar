import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js/lib/core';
import box from 'plotly.js/lib/box';
import heatmap from 'plotly.js/lib/heatmap';
import histogram from 'plotly.js/lib/histogram';
import scatter from 'plotly.js/lib/scatter';

type PlotFigure = {
  data: unknown[];
  layout: Record<string, unknown>;
};

type LazyPlotFigureProps = {
  figure: PlotFigure;
};

Plotly.register([box, heatmap, histogram, scatter]);
const Plot = createPlotlyComponent(Plotly);

function LazyPlotFigure({ figure }: LazyPlotFigureProps) {
  return (
    <Plot
      data={figure.data as never[]}
      layout={{
        autosize: true,
        ...figure.layout,
      }}
      config={{ responsive: true, displaylogo: false }}
      className="w-full"
      useResizeHandler
      style={{ width: '100%', minHeight: 420 }}
    />
  );
}

export default LazyPlotFigure;
