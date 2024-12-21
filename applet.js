const Applet = imports.ui.applet;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

function MyApplet(metadata, orientation, panel_height, instance_id) {
  this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
  __proto__: Applet.TextApplet.prototype,

  _init: function (metadata, orientation, panel_height, instance_id) {
    Applet.TextApplet.prototype._init.call(
      this,
      orientation,
      panel_height,
      instance_id
    );

    this.set_applet_label("Checking dependencies...");
    this.set_applet_tooltip("Network Monitor");

    this._timeout = null;

    // Check if vnstat is installed
    if (this._isVnstatInstalled()) {
      this.set_applet_label("Initializing...");
      this._firstLineSkipped = false;
      this._updateNetworkStats();
      this._timeout = Mainloop.timeout_add_seconds(10, () => {
        this._updateNetworkStats();
        return true;
      });
    } else {
      this.set_applet_label("vnstat not installed");
      this.set_applet_tooltip(
        "Please install 'vnstat' using your package manager:\n" +
          "e.g., sudo apt install vnstat (for Debian/Ubuntu)"
      );
    }
  },

  _isVnstatInstalled: function () {
    try {
      let [res] = GLib.spawn_command_line_sync("which vnstat");
      return res && res.toString().trim() !== ""; // Check if output is non-empty
    } catch (error) {
      global.logError("Error checking vnstat installation: " + error);
      return false;
    }
  },

  _formatBytes: function (bytes) {
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let unitIndex = 0;

    while (bytes >= 1024 && unitIndex < units.length - 1) {
      bytes /= 1024;
      unitIndex++;
    }

    return `${bytes.toFixed(2)} ${units[unitIndex]}`;
  },

  _updateNetworkStats: function () {
    global.log("Updating Network Stats...");
    try {
      let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
        null,
        ["/usr/bin/vnstat", "-l", "-i", "wlp0s20f3", "--json"],
        null,
        GLib.SpawnFlags.DO_NOT_REAP_CHILD,
        null
      );

      if (success) {
        global.log("Command executed successfully");

        let stdoutStream = new Gio.DataInputStream({
          base_stream: new Gio.UnixInputStream({ fd: stdout, close_fd: true }),
        });

        const readNextLine = () => {
          stdoutStream.read_line_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (stream, result) => {
              try {
                let [line, length] = stream.read_line_finish(result);
                if (line) {
                  let lineString = line.toString();

                  if (!this._firstLineSkipped) {
                    global.log("Skipping first line: " + lineString);
                    this._firstLineSkipped = true;
                  } else {
                    global.log("Processing line: " + lineString);
                    let data = JSON.parse(lineString);

                    if (data.rx && data.tx) {
                      let rx = this._formatBytes(data.rx.bytes);
                      let tx = this._formatBytes(data.tx.bytes);

                      this.set_applet_label(`⬇️ ${rx} ⬆️ ${tx}`);
                      this.set_applet_tooltip(
                        `Download: ${rx}\nUpload: ${tx}`
                      );
                    } else {
                      global.logError("Invalid network data");
                      this.set_applet_label("Error: Invalid data");
                    }
                  }

                  readNextLine();
                } else {
                  global.log("No more lines to read");
                }
              } catch (e) {
                global.logError("Error parsing output: " + e);
                this.set_applet_label("Parse Error");
              }
            }
          );
        };

        readNextLine();
      } else {
        global.logError("Failed to execute command");
        this.set_applet_label("Execution Error");
      }
    } catch (error) {
      global.logError("Exception: " + error);
      this.set_applet_label("Error");
    }
  },

  on_applet_removed_from_panel: function () {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
  },
};

function main(metadata, orientation, panel_height, instance_id) {
  return new MyApplet(metadata, orientation, panel_height, instance_id);
}
