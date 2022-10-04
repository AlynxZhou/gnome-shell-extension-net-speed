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

/* exported init */

// const GETTEXT_DOMAIN = "net-speed";

const {GObject, GLib, Gio, Clutter, St} = imports.gi;

// const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
// const _ = Gettext.gettext;

const ByteArray = imports.byteArray;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
// const PopupMenu = imports.ui.popupMenu;

const refreshInterval = 3;
const speedUnits = [
    "B/s", "K/s", "M/s", "G/s", "T/s", "P/s", "E/s", "Z/s", "Y/s"
];
let lastTotalDownBytes = 0;
let lastTotalUpBytes = 0;

const getCurrentNetSpeed = (refreshInterval) => {
    const speed = {"down": 0, "up": 0};

    try {
        const inputFile = Gio.File.new_for_path("/proc/net/dev");
        const [, content] = inputFile.load_contents(null);
        // See <https://github.com/GNOME/gjs/blob/master/doc/ByteArray.md#tostringauint8array-encodingstringstring>.
        const lines = ByteArray.toString(content).split('\n');

        // Caculate the sum of all interfaces' traffic line by line.
        let totalDownBytes = 0;
        let totalUpBytes = 0;

        for (let i = 0; i < lines.length; ++i) {
            const fields = lines[i].trim().split(/\W+/);
            if (fields.length <= 2) {
                continue;
            }

            // Skip virtual interfaces.
            const interface = fields[0];
            const currentInterfaceDownBytes = Number.parseInt(fields[1]);
            const currentInterfaceUpBytes = Number.parseInt(fields[9]);
            if (interface === "lo" ||
                // Created by python-based bandwidth manager "traffictoll".
                interface.match(/^ifb[0-9]+/) ||
                // Created by lxd container manager.
                interface.match(/^lxdbr[0-9]+/) ||
                interface.match(/^virbr[0-9]+/) ||
                interface.match(/^br[0-9]+/) ||
                interface.match(/^vnet[0-9]+/) ||
                interface.match(/^tun[0-9]+/) ||
                interface.match(/^tap[0-9]+/) ||
                isNaN(currentInterfaceDownBytes) ||
                isNaN(currentInterfaceUpBytes)) {
                continue;
            }

            totalDownBytes += currentInterfaceDownBytes;
            totalUpBytes += currentInterfaceUpBytes;
        }

        if (lastTotalDownBytes === 0) {
            lastTotalDownBytes = totalDownBytes;
        }
        if (lastTotalUpBytes === 0) {
            lastTotalUpBytes = totalUpBytes;
        }

        speed["down"] = (totalDownBytes - lastTotalDownBytes) / refreshInterval;
        speed["up"] = (totalUpBytes - lastTotalUpBytes) / refreshInterval;

        lastTotalDownBytes = totalDownBytes;
        lastTotalUpBytes = totalUpBytes;
    } catch (e) {
        logError(e);
    }

    return speed;
};

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

        // let item = new PopupMenu.PopupMenuItem(_("Show Notification"));
        // item.connect("activate", () => {
        //     Main.notify(_("Whatʼs up, folks?"));
        // });
        // this.menu.addMenuItem(item);
    }

    setText(text) {
        return this._label.set_text(text);
    }
});

class Extension {
    constructor(uuid) {
        this._uuid = uuid;

        // ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        lastTotalDownBytes = 0;
        lastTotalUpBytes = 0;

        this._indicator = new Indicator();
        // role, indicator, position, box.
        // -1 is not OK, because it will show in the right side of system menu.
        Main.panel.addToStatusArea(this._uuid, this._indicator, 0, "right");

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, refreshInterval, () => {
                const speed = getCurrentNetSpeed(refreshInterval);
                const text = toSpeedString(speed);
                // log(text);
                this._indicator.setText(text);
                // Run as loop, not once.
                return GLib.SOURCE_CONTINUE;
            }
        )
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
}

function init(meta) {
    return new Extension(meta.uuid);
}
