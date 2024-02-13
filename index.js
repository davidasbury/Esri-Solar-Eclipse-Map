/*    
    Copyright 2024 Esri

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

require([
  "esri/Map",
  "esri/Graphic",
  "esri/geometry/SpatialReference",
  "esri/symbols/FillSymbol3DLayer",
  "esri/symbols/PolygonSymbol3D",
  "esri/renderers/SimpleRenderer",
  "esri/layers/GraphicsLayer",
  "esri/rest/support/Query",
  "esri/rest/query",
  "esri/widgets/BasemapToggle",
  "esri/widgets/BasemapToggle/BasemapToggleViewModel",
  "esri/views/SceneView",
  "esri/renderers/UniqueValueRenderer",
  "esri/renderers/support/UniqueValueGroup",
  "esri/renderers/support/UniqueValueClass",
  "esri/layers/SceneLayer",
  "dojo/domReady!",
], function (
  Map,
  Graphic,
  SpatialReference,
  FillSymbol3DLayer,
  PolygonSymbol3D,
  SimpleRenderer,
  GraphicsLayer,
  Query,
  query,
  BasemapToggle,
  BasemapToggleViewModel,
  SceneView,
  UniqueValueRenderer,
  UniqueValueGroup,
  UniqueValueClass,
  SceneLayer
) {
  $(document).ready(function () {
    // Enforce strict mode
    ("use strict");

    // Application constants
    var SOLAR =
      "https://services.arcgis.com/nzS0F0zdNLvs7nc8/arcgis/rest/services/EclipsePolygons_1601_2200/FeatureServer/18";
    //"https://services.arcgis.com/6DIQcwlPy8knb6sg/arcgis/rest/services/SolarEclipsePath/FeatureServer/0";

    var GEOMETRYPRECISION = 2;
    var MAXALLOWABLEOFFSET = 0.1;
    var DATE_MIN = 1600;
    var DATE_MAX = 2200;
    var DATE_STA = 1850;
    var DURATION_MIN = 0;
    var DURATION_MAX = 800;
    var POINTER_WIDTH = 30; // years

    // Application variables
    var _paths = null;
    var _currentTime = DATE_STA;

    // Create map and view
    var _view = new SceneView({
      container: "map",
      ui: {
        // Only show zoom-in, zoom-out and compass elements
        components: ["zoom", "compass"],
      },
      padding: {
        // Encourage the globe to leave some space at the bottom of the window for the chart
        left: 0,
        top: 50,
        right: 0,
        bottom: 200,
      },
      center: [-90, 12], // Center the globe
      environment: {
        // Disable lighting and stars
        lighting: {
          directShadows: false,
          ambientOcclusion: false,
          cameraTrackingEnabled: true,
        },
        atmosphereEnabled: true,
        atmosphere: {
          quality: "high",
        },
        starsEnabled: false,
      },

      map: new Map({
        basemap: "navigation-dark-3d",
        ground: "world-elevation",
        layers: [
          new GraphicsLayer({
            id: "solar",
            elevationInfo: {
              mode: "on-the-ground",
            },
            //graphics: [graphics],
          }),
          new GraphicsLayer({
            // This layer will be used to simulate selection
            id: "highlight",
            elevationInfo: {
              mode: "on-the-ground",
            },
          }),
        ],
      }),
    });

    // Define colors for chart
    var color = d3
      .scaleOrdinal()
      .domain(["Total", "Hybrid", "Annular"])
      .range(["#F5A61C", "#FF4E00", "#8F6FEB"]);

    _view.when(function () {
      $.when(
        downloadData(0, 200),
        downloadData(200, 200),
        downloadData(400, 200),
        downloadData(600, 200),
        downloadData(800, 200)
      ).done(function (v1, v2, v3, v4, v5) {
        // Change loading message
        $(".loading-message").html("Loading data...");

        // Concatenate all graphics
        _paths = [].concat.call(v1, v2, v3, v4, v5);

        // Load the chart
        drawChart();

        // Reload chart if window resized
        var width = $(window).width();
        $(window).debounce(
          "resize",
          function () {
            // Exit if width is unchanged
            var w = $(window).width();
            if (width !== w) {
              width = w;
              // Reload chart
              drawChart();
            }
          },
          250
        );

        // Hide loading dialog
        $(".loading").hide();

        // Show chart
        $("#chart").animate(
          {
            "margin-bottom": "0px",
          },
          {
            duration: 400,
            easing: "swing",
            queue: false,
          }
        );
      });
    });
    _view.on("click", function (e) {
      // Something is not right. Exit.
      if (!e) {
        return;
      }

      // Clear selection
      _view.map.findLayerById("highlight").removeAll();
      d3.selectAll("#chart circle.eclipse").style("fill", false);

      // Find intersecting path (if any)
      var g = _view.map.findLayerById("solar").graphics.find(function (item) {
        return item.geometry.contains(e.mapPoint);
      });
      if (!g) {
        d3.selectAll("#chart circle.eclipse")
          .classed("hover", false)
          .attr("r", 3)
          .style("fill", function (d) {
            return color(d.attributes.EclType_simple);
          });
        hideInfomationPanel();
        return;
      }

      // Highlight clicked path.
      _view.map.findLayerById("highlight").add(
        new Graphic({
          attributes: g.attributes,
          geometry: g.geometry,
          symbol: new PolygonSymbol3D({
            symbolLayers: [
              new FillSymbol3DLayer({
                material: {
                  color: "rgba(0, 255, 255, 0.5)",
                },
              }),
            ],
          }),
        })
      );

      // Show slide-in info panel.
      showInfomationPanel(g);

      //
      d3.selectAll("#chart circle.eclipse")
        .classed("hover", function (d) {
          return d.attributes.OBJECTID === g.attributes.OBJECTID;
        })
        .attr("r", function (d) {
          return d.attributes.OBJECTID === g.attributes.OBJECTID ? 5 : 3;
        })
        .style("fill", function (d) {
          return d.attributes.OBJECTID === g.attributes.OBJECTID
            ? "#00ffff"
            : color(d.attributes.EclType_simple);
        });
    });

    var toggle = new BasemapToggle(
      {
        viewModel: new BasemapToggleViewModel({
          view: _view,
          nextBasemap: "satellite",
        }),
      },
      "basemapToggle"
    );
    //toggle.startup();

    $("#button-help").click(function () {
      $("#window-help").fadeIn();
      $("#top").animate(
        {
          "margin-top": "-50px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
      $("#chart").animate(
        {
          "margin-bottom": "-200px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
    });

    $("#button-about").click(function () {
      $("#window-about").fadeIn();
      $("#top").animate(
        {
          "margin-top": "-50px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
      $("#chart").animate(
        {
          "margin-bottom": "-200px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
    });

    $(".dialog .close").click(function () {
      $(this).parents(".dialog").fadeOut();
      $("#top").animate(
        {
          "margin-top": "0px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
      $("#chart").animate(
        {
          "margin-bottom": "0px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
    });

    $("a").attr("target", "_blank");

    function downloadData(start, num) {
      var defer = new $.Deferred();
      var queryObject = new Query({
        start: start,
        num: num,
        returnGeometry: true,
        geometryPrecision: GEOMETRYPRECISION,
        maxAllowableOffset: MAXALLOWABLEOFFSET,
        outFields: [
          "EclType", // Eclipse Type
          "Date", // Eclipse Date
          "TimeGE", // Eclipse Time
          "DurationSeconds", // Duration at Maximum Eclipse (seconds)
          "PathWid", // Path Width (km)
          "EclMagn", // Eclipse Magnitude
          "SunAlt", // Sun Altitude (°)
          "SunAzi", // Sun Azimuth (°)
          "Lunation", // Lunation
          "Saro", // Saros Cycle
          "Gamma", // Gamma
          "DT", // Delta-T (seconds)
          "EclType_simple", // Simplified classification
          "Latitude",
          "Longitud",
        ],
        orderByFields: ["Date"],
        outSpatialReference: new SpatialReference({
          wkid: 4326,
        }),
        where: "1=1",
      });
      query.executeQueryJSON(SOLAR, queryObject).then(function (r) {
        defer.resolve(r.features);
      });
      return defer.promise();
    }

    function drawChart() {
      // Remove SVG container (if any)
      d3.select("#chart svg").remove();

      // Define padding inside 'chart' div
      var margin = {
        left: 75,
        top: 20,
        right: 50,
        bottom: 35,
      };

      // Create SVG container
      var width = $("#chart").width();
      var height = $("#chart").height();
      var svg = d3
        .select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

      // Define scales
      var x = d3
        .scaleLinear()
        .domain([DATE_MIN, DATE_MAX])
        .range([0, width - margin.left - margin.right]);
      var y = d3
        .scaleLinear()
        .domain([DURATION_MIN, DURATION_MAX])
        .range([height - margin.top - margin.bottom, 0]);

      // Define axises
      var xaxis = d3.axisBottom(x).tickFormat(d3.format("d"));
      var yaxis = d3.axisLeft(y).tickValues([0, 200, 400, 600, 800]);

      // Draw x-axis
      svg
        .append("g")
        .classed("axis", true)
        .attr(
          "transform",
          $.format("translate({0},{1})", [margin.left, height - margin.bottom])
        )
        .call(xaxis);

      // Draw y-axis
      svg
        .append("g")
        .classed("axis", true)
        .attr(
          "transform",
          $.format("translate({0},{1})", [margin.left, margin.top])
        )
        .call(yaxis)
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -30)
        .attr("y", -50)
        .style("text-anchor", "end")
        .text("Duration (s)");

      // create a D3 brush
      // start year label
      /*      var cx = svg.append("g").attr("cx", function (d) {
        var date = new Date(d.attributes.Date);
        return x(date.getFullYear());
      });
      console.log(cx);
*/ var labelL = svg
        .append("g")
        .attr("cx", "labelleft")
        .attr("x", 0)
        .attr("y", height + margin.top);
      // end year label
      var labelR = svg
        .append("text")
        .attr("Date", "labelright")
        .attr("x", 0)
        .attr("y", height + margin.top);

      const brush = d3
        .brushX()
        .extent([
          [margin.left, margin.top],
          [width - margin.right, height - margin.bottom],
        ])
        .on("brush", brushed)
        .on("end", brushended);

      // create a default selection for the brush
      const defaultSelection = [
        x(_currentTime) + margin.left,
        x(_currentTime) + margin.left + POINTER_WIDTH,
      ];

      const gb = svg.append("g").call(brush).call(brush.move, defaultSelection);

      var dragOffset = 0;
      function brushed() {
        if (d3.select("#chart")) {
          svg.style("fill", "#569fd5");
          //var s = d3.event.selection;
          // update and move labels
          //labelL.attr("x", s[0]).text(x.invert(s[0]).toFixed(2));
          //labelR.attr("x", s[1]).text(x.invert(s[1]).toFixed(2));
          svg.call(
            d3
              .drag()
              .on("start", function () {
                // Suppress drag events
                d3.event.sourceEvent.stopPropagation();
                d3.event.sourceEvent.preventDefault();

                // Disable dot events
                d3.selectAll("#chart circle.eclipse").classed("disabled", true);

                //
                dragOffset =
                  x.invert(d3.mouse(this.parentNode)[0]) - _currentTime;
              })
              .on("drag", function () {
                _currentTime = x.invert(d3.mouse(this.parentNode)[0]);
                _currentTime -= dragOffset;
                if (_currentTime < DATE_MIN) {
                  _currentTime = DATE_MIN;
                } else if (_currentTime > DATE_MAX - POINTER_WIDTH) {
                  _currentTime = DATE_MAX - POINTER_WIDTH;
                }

                // Move time pointer
                //movePointer();

                // Draw selected eclipses on globe
                drawEclipses();
              })
              .on("end", function () {
                // Restore event listening for all dots
                d3.selectAll("#chart circle.eclipse").classed(
                  "disabled",
                  false
                );
              })
          );
        }
      }
      function brushended() {
        if (!d3.select("#chart")) {
          gb.call(brush.move, defaultSelection);
        }
      }

      /*
      // Add the pointer
      var dragOffset = 0;
      svg
        .append("g")
        .attr(
          "transform",
          $.format("translate({0},{1})", [margin.left, margin.top])
        )
        .append("polygon")
        .classed("pointer", true)
        .attr(
          "transform",
          $.format("translate({0},{1})", [x(_currentTime), 0]))
        .attr(
          "points",
          $.format("{0},{1} {2},{3} {4},{5} {6},{7}", [
            x(DATE_MIN),
            y(DURATION_MIN),
            x(DATE_MIN),
            y(DURATION_MAX),
            x(DATE_MIN + POINTER_WIDTH),
            y(DURATION_MAX),
            x(DATE_MIN + POINTER_WIDTH),
            y(DURATION_MIN),
          ])
        )
        .call(
          d3
            .drag()
            .on("start", function () {
              // Suppress drag events
              d3.event.sourceEvent.stopPropagation();
              d3.event.sourceEvent.preventDefault();

              // Disable dot events
              d3.selectAll("#chart circle.eclipse").classed("disabled", true);

              //
              dragOffset =
                x.invert(d3.mouse(this.parentNode)[0]) - _currentTime;
            })
            .on("drag", function () {
              _currentTime = x.invert(d3.mouse(this.parentNode)[0]);
              _currentTime -= dragOffset;
              if (_currentTime < DATE_MIN) {
                _currentTime = DATE_MIN;
              } else if (_currentTime > DATE_MAX - POINTER_WIDTH) {
                _currentTime = DATE_MAX - POINTER_WIDTH;
              }

              // Move time pointer
              movePointer();

              // Draw selected eclipses on globe
              drawEclipses();
            })
            .on("end", function () {
              // Restore event listening for all dots
              d3.selectAll("#chart circle.eclipse").classed("disabled", false);
            })
        );
*/
      // Add data dots
      svg
        .append("g")
        .attr(
          "transform",
          $.format("translate({0},{1})", [margin.left, margin.top])
        )
        .selectAll("circle")
        .data(_paths)
        .enter()
        .append("circle")
        .classed("eclipse", true)
        .attr("cx", function (d) {
          var date = new Date(d.attributes.Date);
          return x(date.getFullYear());
        })
        .attr("cy", function (d) {
          return y(d.attributes.DurationSeconds);
        })
        .attr("r", 3)
        .style("fill", function (d) {
          return color(d.attributes.EclType_simple);
        })

        .on("mouseenter", function (d) {
          // Highlight dot
          d3.select(this)
            .classed("hover", true)
            .attr("r", 5)
            .style("fill", "#00ffff");

          // Add highlighted eclipse path
          _view.map.findLayerById("highlight").add(
            new Graphic({
              attributes: d.attributes,
              geometry: d.geometry,
              symbol: new PolygonSymbol3D({
                symbolLayers: [
                  new FillSymbol3DLayer({
                    material: {
                      color: "rgba(0, 255, 255, 0.5)",
                    },
                  }),
                ],
              }),
            })
          );

          //
          showInfomationPanel(d);
        })
        .on("mouseleave", function () {
          // Restore dot's color and size
          d3.select(this)
            .classed("hover", false)
            .attr("r", 3)
            .style("fill", function (d) {
              return color(d.attributes.EclType_simple);
            });

          // Remove highlighted eclipse path
          _view.map.findLayerById("highlight").removeAll();

          //
          hideInfomationPanel();
        })
        .on("click", function (d) {
          // Update current time
          var date = new Date(d.attributes.Date);
          _currentTime = date.getFullYear();

          // Pan to selected graphic
          if (d.geometry.extent.center.longitude > 0.5) {
            var new_center = [
              d.geometry.extent.center.longitude,
              d.geometry.extent.center.latitude,
            ];
          } else if (d.geometry.extent.center.longitude < 0) {
            var new_center = [
              d.geometry.extent.center.longitude + 359,
              d.geometry.extent.center.latitude,
            ];
          }
          // Deal with features that cross the 180º discontinuity
          else {
            var new_center = [179.9, d.geometry.extent.center.latitude];
          }

          _view.goTo({
            center: new_center,
            heading: 0,
          });

          // Move time pointer
          //movePointer();

          // Draw selected eclipses on globe
          drawEclipses();

          // Highlight clicked path.
          _view.map.findLayerById("highlight").add(
            new Graphic({
              attributes: d.attributes,
              geometry: d.geometry,
              symbol: new PolygonSymbol3D({
                symbolLayers: [
                  new FillSymbol3DLayer({
                    material: {
                      color: "rgba(0, 255, 255, 0.5)",
                    },
                  }),
                ],
              }),
            })
          );

          // Show slide-in info panel.
          showInfomationPanel(d);
        });

      // Add year range title
      svg
        .append("g")
        .attr(
          "transform",
          $.format("translate({0},{1})", [margin.left, margin.top])
        )
        .classed("title", true)
        .append("text")
        .style("text-anchor", "middle");

      // Position the pointer and select graphics
      //movePointer();

      // Draw selected eclipses on globe
      drawEclipses();
      /*
      function movePointer() {
        // Clear selection
        hideInfomationPanel();
        _view.map.findLayerById("highlight").removeAll();

        // Move red timeline into position
        d3.select("#chart polygon.pointer").attr(
          "transform",
          $.format("translate({0},{1})", [x(_currentTime), 0])
        );

        // Update time window extent text
        //var ccc = $.format('{0}–{1}', [
        //        d3.round(_currentTime),
        //        d3.round(_currentTime) + POINTER_WIDTH
        //]);
        d3.select("#chart g.title text")
          .attr(
            "transform",
            $.format("translate({0},{1})", [
              x(_currentTime + POINTER_WIDTH / 2),
              -2,
            ])
          )
          .text(
            $.format("{0}–{1}", [
              d3.format(".0f")(_currentTime),
              d3.format(".0f")(_currentTime + POINTER_WIDTH),
            ])
          );
      }
*/
      function drawEclipses() {
        // Highlight eclipses within the pointer
        d3.selectAll("#chart circle.eclipse").classed("selected", function (d) {
          var date = new Date(d.attributes.Date);
          var year = date.getFullYear();
          return year >= _currentTime && year <= _currentTime + POINTER_WIDTH;
        });

        //
        var graphics = [];
        d3.selectAll("#chart circle.eclipse.selected").each(function (d) {
          if (d.attributes.EclType_simple == "Total") {
            graphics.push(
              new Graphic({
                attributes: d.attributes,
                geometry: d.geometry,
                symbol: {
                  type: "simple-fill", // autocasts as new SimpleFillSymbol()
                  color: "rgba(245, 166, 28, 0.5)",
                  //color: "#F5A61C",
                  outline: {
                    // autocasts as new SimpleLineSymbol()
                    color: "#F5A61C",
                    width: 0,
                  },
                },
              })
            );
          } else if (d.attributes.EclType_simple == "Hybrid") {
            graphics.push(
              new Graphic({
                attributes: d.attributes,
                geometry: d.geometry,
                symbol: {
                  type: "simple-fill", // autocasts as new SimpleFillSymbol()
                  color: "rgba(255, 78, 0, 0.5)",
                  //color: "#FF4E00",
                  outline: {
                    // autocasts as new SimpleLineSymbol()
                    color: "#FF4E00",
                    width: 0,
                  },
                },
              })
            );
          } else if (d.attributes.EclType_simple == "Annular") {
            graphics.push(
              new Graphic({
                attributes: d.attributes,
                geometry: d.geometry,
                symbol: {
                  type: "simple-fill", // autocasts as new SimpleFillSymbol()
                  color: "rgba(143, 111, 235, 0.5)",
                  //color: "#8F6FEB",
                  outline: {
                    // autocasts as new SimpleLineSymbol()
                    color: "#8F6FEB",
                    width: 0,
                  },
                },
              })
            );
          }
        });
        _view.map.findLayerById("solar").removeAll();
        _view.map.findLayerById("solar").addMany(graphics);
      }
    }

    function showInfomationPanel(graphic) {
      $("#panel").animate(
        {
          "margin-right": "0px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );

      // Update title
      switch (graphic.attributes.EclType) {
        case "A":
          $("#panel-title").html("Annular Solar Eclipse");
          break;
        case "An":
          $("#panel-title").html("Annular Solar Eclipse (no northern limit)");
          break;
        case "As":
          $("#panel-title").html("Annular Solar Eclipse (no southern limit)");
          break;
        case "A+":
          $("#panel-title").html(
            "Annular Solar Eclipse (no northern limit and no central line)"
          );
          break;
        case "A-":
          $("#panel-title").html(
            "Annular Solar Eclipse (no southern limit and no central line)"
          );
          break;
        case "Am":
          $("#panel-title").html(
            "Annular Solar Eclipse (middle eclipse of Saros)"
          );
          break;
        case "H":
          $("#panel-title").html(
            "Hybrid Solar Eclipse (annular-total-annular)"
          );
          break;
        case "H2":
          $("#panel-title").html(
            "Hybrid Solar Eclipse (begins total, ends annular)"
          );
          break;
        case "H3":
          $("#panel-title").html(
            "Hybrid Solar Eclipse (begins annular, ends total)"
          );
          break;
        case "Hm":
          $("#panel-title").html(
            "Hybrid Solar Eclipse (middle eclipse of Saros)"
          );
          break;
        case "T":
          $("#panel-title").html("Total Solar Eclipse");
          break;
        case "Tn":
          $("#panel-title").html("Total Solar Eclipse (no northern limit)");
          break;
        case "Ts":
          $("#panel-title").html("Total Solar Eclipse (no southern limit)");
          break;
        case "T+":
          $("#panel-title").html(
            "Total Solar Eclipse (no northern limit and no central line)"
          );
          break;
        case "T-":
          $("#panel-title").html(
            "Total Solar Eclipse (no southern limit and no central line)"
          );
          break;
        case "Tm":
          $("#panel-title").html(
            "Total Solar Eclipse (middle eclipse of Saros)"
          );
          break;
        default:
          $("#panel-title").html("Solar Eclipse");
          break;
      }

      // Update attributes in panel
      const options = { timeZone: "UTC", timeZoneName: "short" };
      var minutes = Math.floor(graphic.attributes.DurationSeconds / 60);
      $("#panel .value:eq(0)").html(
        new Date(graphic.attributes.Date).toLocaleDateString("en-US")
      );
      $("#panel .value:eq(1)").html(graphic.attributes.Saro);

      $("#panel .value:eq(2)").html(graphic.attributes.Lunation);
      $("#panel .value:eq(3)").html(graphic.attributes.Gamma);
      $("#panel .value:eq(4)").html(graphic.attributes.DT + " seconds");
      $("#panel .value:eq(5)").html(" ");
      $("#panel .value:eq(6)").html(graphic.attributes.Latitude + "º");
      $("#panel .value:eq(7)").html(graphic.attributes.Longitud + "º");
      $("#panel .value:eq(8)").html(
        new Date(graphic.attributes.TimeGE).toLocaleTimeString("en-US")
      );
      $("#panel .value:eq(11)").html(
        minutes +
          " m " +
          (graphic.attributes.DurationSeconds - minutes * 60) +
          " s"
      );
      $("#panel .value:eq(12)").html(graphic.attributes.PathWid + " km");
      $("#panel .value:eq(13)").html(graphic.attributes.EclMagn);
      $("#panel .value:eq(9)").html(graphic.attributes.SunAlt + "°");
      $("#panel .value:eq(10)").html(graphic.attributes.SunAzi + "°");
    }

    function hideInfomationPanel() {
      $("#panel").animate(
        {
          "margin-right": "-200px",
        },
        {
          duration: 400,
          easing: "swing",
          queue: false,
        }
      );
    }

    // jQuery formating function
    $.format = function (f, e) {
      $.each(e, function (i) {
        f = f.replace(new RegExp("\\{" + i + "\\}", "gm"), this);
      });
      return f;
    };

    // jQuery debounce function
    $.fn.debounce = function (on, func, threshold) {
      var debounce = function (func, threshold, execAsap) {
        var timeout;
        return function debounced() {
          var obj = this;
          var args = arguments;
          function delayed() {
            if (!execAsap) {
              func.apply(obj, args);
            }
            timeout = null;
          }
          if (timeout) {
            clearTimeout(timeout);
          } else if (execAsap) {
            func.apply(obj, args);
          }
          timeout = setTimeout(delayed, threshold || 100);
        };
      };
      $(this).on(on, debounce(func, threshold));
    };
  });
});
