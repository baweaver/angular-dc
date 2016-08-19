/* globals colorbrewer, crossfilter */

'use strict';

angular.module('app', ['angularDc', 'angularJade']);

var myController = function($scope) {
  d3.csv('ndx.csv', function (data) {
    /* since its a csv file we need to format the data a bit */
    var dateFormat   = d3.time.format('%m/%d/%Y');
    var numberFormat = d3.format('.2f');

    $scope.colorbrewer = colorbrewer;

    data.forEach(function (d) {
      d.dd    = dateFormat.parse(d.date);
      d.month = d3.time.month(d.dd); // pre-calculate month for better performance
      d.close = +d.close; // coerce to number
      d.open  = +d.open;
    });

    // ### Create Crossfilter Dimensions and Groups
    // See the [crossfilter API](https://github.com/square/crossfilter/wiki/API-Reference) for reference.
    var ndx = $scope.ndx = crossfilter(data);
    var all = $scope.all = ndx.groupAll();

    // dimension by year
    $scope.yearlyDimension = ndx.dimension(function (d) {
      return d3.time.year(d.dd).getFullYear();
    });

    // maintain running tallies by year as filters are applied or removed
    $scope.yearlyPerformanceGroup = $scope.yearlyDimension.group().reduce(
      /* callback for when data is added to the current filter results */
      function (state, value) {
        ++state.count;

        state.absGain     += value.close - value.open;
        state.fluctuation += Math.abs(value.close - value.open);
        state.sumIndex    += (value.open + value.close) / 2;

        state.avgIndex              = state.sumIndex / state.count;
        state.percentageGain        = (state.absGain / state.avgIndex) * 100;
        state.fluctuationPercentage = (state.fluctuation / state.avgIndex) * 100;

        return state;
      },

      /* callback for when data is removed from the current filter results */
      function (state, value) {
        --state.count;

        state.absGain     -= value.close - value.open;
        state.fluctuation -= Math.abs(value.close - value.open);
        state.sumIndex    -= (value.open + value.close) / 2;

        state.avgIndex              = state.sumIndex / state.count;
        state.percentageGain        = (state.absGain / state.avgIndex) * 100;
        state.fluctuationPercentage = (state.fluctuation / state.avgIndex) * 100;

        return state;
      },

      /* initialize state */
      function () {
        return {
          count:                 0,
          absGain:               0,
          fluctuation:           0,
          fluctuationPercentage: 0,
          sumIndex:              0,
          avgIndex:              0,
          percentageGain:        0
        };
      }
    );

    // dimension by full date
    $scope.dateDimension = ndx.dimension(function (d) { return d.dd; });

    // dimension by month
    $scope.moveMonths = ndx.dimension(function (d) { return d.month; });

    // group by total movement within month
    $scope.monthlyMoveGroup = $scope.moveMonths.group().reduceSum(function (d) {
      return Math.abs(d.close - d.open);
    });

    // group by total volume within move, and scale down result
    $scope.volumeByMonthGroup = $scope.moveMonths.group().reduceSum(function (d) {
      return d.volume / 500000;
    });

    $scope.indexAvgByMonthGroup = $scope.moveMonths.group().reduce(
      function (state, value) {
        ++state.days;

        state.total += (value.open + value.close) / 2;
        state.avg = Math.round(state.total / state.days);

        return state;
      },
      function (state, value) {
        --state.days;

        state.total -= (value.open + value.close) / 2;
        state.avg = state.days ? Math.round(state.total / state.days) : 0;

        return state;
      },
      function () {
        return {
          days:  0,
          total: 0,
          avg:   0
        };
      }
    );

    // create categorical dimension
    $scope.gainOrLoss = ndx.dimension(function (d) {
      return d.open > d.close ? 'Loss' : 'Gain';
    });

    // produce counts records in the dimension
    $scope.gainOrLossGroup = $scope.gainOrLoss.group();

    // determine a histogram of percent changes
    $scope.fluctuation = ndx.dimension(function (d) {
      return Math.round((d.close - d.open) / d.open * 100);
    });

    $scope.fluctuationGroup = $scope.fluctuation.group();

    // summerize volume by quarter
    $scope.quarter = ndx.dimension(function (d) {
      var month = d.dd.getMonth();

      if (month <= 2) {
        return 'Q1';
      } else if (month > 3 && month <= 5) {
        return 'Q2';
      } else if (month > 5 && month <= 8) {
        return 'Q3';
      } else {
        return 'Q4';
      }
    });

    $scope.quarterGroup = $scope.quarter.group().reduceSum(function (d) {
      return d.volume;
    });

    // counts per weekday
    $scope.dayOfWeek = ndx.dimension(function (d) {
      var day  = d.dd.getDay();
      var name = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

      return day + '.' + name[day];
    });

    $scope.dayOfWeekGroup = $scope.dayOfWeek.group();

    //### Define Chart Attributes
    //Define chart attributes using fluent methods. See the [dc API Reference](https://github.com/dc-js/dc.js/blob/master/web/docs/api-1.7.0.md) for more information
    //
    $scope.gainOrLossChartLabel = function (d) {
      // if an option is a function, it is called with this beinh the chart
      if (this.hasFilter() && !this.hasFilter(d.key)) {
        return d.key + '(0%)';
      }

      return d.key + '(' + Math.floor(d.value / all.value() * 100) + '%)';
    };

    $scope.bubbleChartOptions = {
      colorAccessor: function (d) {
        return d.value.absGain;
      },
      keyAccessor: function (p) {
        return p.value.absGain;
      },
      valueAccessor: function (p) {
        return p.value.percentageGain;
      },
      radiusValueAccessor: function (p) {
        return p.value.fluctuationPercentage;
      },
      label: function (p) {
        return p.key;
      },
      title: function (p) {
        return [
          p.key,
          'Index Gain: ' + numberFormat(p.value.absGain),
          'Index Gain in Percentage: ' + numberFormat(p.value.percentageGain) + '%',
          'Fluctuation / Index Ratio: ' + numberFormat(p.value.fluctuationPercentage) + '%'
        ].join('\n');
      }
    };

    $scope.fluctuationChartOptions = {
      filterPrinter: function (filters) {
        var filter = filters[0],
            s      = '';

        s += numberFormat(filter[0]) + '% -> ' + numberFormat(filter[1]) + '%';

        return s;
      }
    };

    $scope.fluctuationChartPostSetupChart = function(c) {
      // Customize axis
      c.xAxis().tickFormat(function (v) { return v + '%'; });
      c.yAxis().ticks(5);
    };

    // #### Stacked Area Chart
    // Specify an area chart, by using a line chart with `.renderArea(true)`
    $scope.moveChartOptions = {
      valueAccessor: function (d) {
        return d.value.avg;
      },

      // title can be called by any stack layer.
      title: function (d) {
        var value = d.value.avg ? d.value.avg : d.value;
        if (isNaN(value)) value = 0;
        return dateFormat(d.key) + '\n' + numberFormat(value);
      }
    };

    $scope.moveChartPostSetupChart = function(chart) {
      // stack additional layers with `.stack`. The first paramenter is a new group.
      // The second parameter is the series name. The third is a value accessor.
      chart.stack($scope.monthlyMoveGroup, 'Monthly Index Move', function (d) {
        return d.value;
      });

      // Add the base layer of the stack with group. The second parameter specifies a series name for use in the legend
      chart.group($scope.indexAvgByMonthGroup, 'Monthly Index Average');
    };

    $scope.dayOfWeekPostSetupChart = function(chart) {
      chart
        .label(function(d) { return d.key.split('.')[1]; })
        .title(function(d) { return d.value; })
        .xAxis()
        .ticks(4);
    };

    // data table does not use crossfilter group but rather a closure
    // as a grouping function
    $scope.tableGroup = function (d) {
      var format = d3.format('02d');
      return d.dd.getFullYear() + '/' + format((d.dd.getMonth() + 1));
    };

    $scope.tablePostSetupChart = function(c) {
      // dynamic columns creation using an array of closures
      c.columns([
        function (d) { return d.date; },
        function (d) { return numberFormat(d.open); },
        function (d) { return numberFormat(d.close); },
        function (d) { return numberFormat(d.close - d.open); },
        function (d) { return d.volume; }
      ])

      // (optional) sort using the given field, :default = function(d){return d;}
      .sortBy(function (d) { return d.dd; })

      // (optional) sort order, :default ascending
      .order(d3.ascending)

      // (optional) custom renderlet to post-process chart using D3
      .renderlet(function (table) {
        table.selectAll('.dc-table-group').classed('info', true);
      });
    };

    $scope.resetAll = function(){
      dc.filterAll();
      dc.redrawAll();
    };

    $scope.$apply();
  });
};
