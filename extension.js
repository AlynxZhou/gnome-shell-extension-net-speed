/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";

const refreshInterval = 3;
const speedUnits = [
  "B/s", "K/s", "M/s", "G/s", "T/s", "P/s", "E/s", "Z/s", "Y/s"
];

const formatSpeedWithUnit = (amount) => {
  let unitIndex = 0;
  while (amount >= 1000 && unitIndex < speedUnits.length - 1) {
    amount /= 1000;
    ++unitIndex;
  }

  let digits = 0;
  // Instead of showing 0.00123456 as 0.00, show it as 0.
  if (amount >= 100 || amount - 0 < 0.01) {
    // 100 M/s, 200 K/s, 300 B/s.
    digits = 0;
  } else if (amount >= 10) {
    // 10.1 M/s, 20.2 K/s, 30.3 B/s.
    digits = 1;
  } else {
    // 1.01 M/s, 2.02 K/s, 3.03 B/s.
    digits = 2;
  }

  // See <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed>.
  return `${amount.toFixed(digits)} ${speedUnits[unitIndex]}`;
};

const toSpeedString = (speed) => {
  return `↓ ${formatSpeedWithUnit(speed["down"])} ↑ ${formatSpeedWithUnit(speed["up"])}`;
};

const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init() {
      // menuAlignment, nameText, dontCreateMenu.
      super._init(0.0, "Net Speed", true);

      this._label = new St.Label({
        "y_align": Clutter.ActorAlign.CENTER,
        "text": "---"
      });

      this.add_child(this._label);
    }

    setText(text) {
      return this._label.set_text(text);
    }
  });

export default class NetSpeed extends Extension {
  constructor(metadata) {
    super(metadata);

    this._metadata = metadata;
    this._uuid = metadata.uuid;

    this._textDecoder = new TextDecoder();
    this._lastTotalDownBytes = 0;
    this._lastTotalUpBytes = 0;
  }

  enable() {
    this._lastTotalDownBytes = 0;
    this._lastTotalUpBytes = 0;

    this._indicator = new Indicator();
    // role, indicator, position, box.
    // -1 is not OK, because it will show in the right side of system menu.
    Main.panel.addToStatusArea(this._uuid, this._indicator, 0, "right");

    this._timeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT, refreshInterval, () => {
        const speed = this.getCurrentNetSpeed(refreshInterval);
        const text = toSpeedString(speed);
        // console.log(text);
        this._indicator.setText(text);
        // Run as loop, not once.
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  disable() {
    if (this._indicator != null) {
      this._indicator.destroy();
      this._indicator = null;
    }
    if (this._timeout != null) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
  }

  getCurrentNetSpeed(refreshInterval) {
    const speed = {"down": 0, "up": 0};

    try {
      const inputFile = Gio.File.new_for_path("/proc/net/dev");
      const [, content] = inputFile.load_contents(null);
      // See <https://github.com/GNOME/gjs/blob/master/doc/ByteArray.md#tostringauint8array-encodingstringstring>.
      //
      // `ByteArray` is deprecated with ES Module, standard JavaScript
      // `TextDecoder` should be used here.
      const lines = this._textDecoder.decode(content).split('\n');

      // Caculate the sum of all interfaces line by line.
      let totalDownBytes = 0;
      let totalUpBytes = 0;

      for (let i = 0; i < lines.length; ++i) {
        const fields = lines[i].trim().split(/\W+/);
        if (fields.length <= 2) {
	  continue;
        }

        // Skip virtual interfaces.
        const iface = fields[0];
        const currentInterfaceDownBytes = Number.parseInt(fields[1]);
        const currentInterfaceUpBytes = Number.parseInt(fields[9]);
        if (iface === "lo" ||
	    // Created by python-based bandwidth manager "traffictoll".
	    iface.match(/^ifb[0-9]+/) ||
	    // Created by lxd container manager.
	    iface.match(/^lxdbr[0-9]+/) ||
	    iface.match(/^virbr[0-9]+/) ||
	    iface.match(/^br[0-9]+/) ||
	    iface.match(/^vnet[0-9]+/) ||
	    iface.match(/^tun[0-9]+/) ||
	    iface.match(/^tap[0-9]+/) ||
	    iface.match(/^docker[0-9]+/) ||
	    iface.match(/^utun[0-9]+/) ||
	    iface.startsWith("veth") ||
	    isNaN(currentInterfaceDownBytes) ||
	    isNaN(currentInterfaceUpBytes)) {
	  continue;
        }

        totalDownBytes += currentInterfaceDownBytes;
        totalUpBytes += currentInterfaceUpBytes;
      }

      if (this._lastTotalDownBytes === 0) {
        this._lastTotalDownBytes = totalDownBytes;
      }
      if (this._lastTotalUpBytes === 0) {
        this._lastTotalUpBytes = totalUpBytes;
      }

      speed["down"] = (totalDownBytes - this._lastTotalDownBytes) /
        refreshInterval;
      speed["up"] = (totalUpBytes - this._lastTotalUpBytes) /
        refreshInterval;

      this._lastTotalDownBytes = totalDownBytes;
      this._lastTotalUpBytes = totalUpBytes;
    } catch (e) {
      console.error(e);
    }

    return speed;
  }
};
