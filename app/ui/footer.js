const html = require('choo/html');
const Component = require('choo/component');

class Footer extends Component {
  constructor(name, state) {
    super(name);
    this.state = state;
  }

  update() {
    return false;
  }

  createElement() {
    return html`
      <footer
        class="flex flex-col md:flex-row items-start w-full flex-none self-start p-6 md:p-8 font-medium text-xs text-grey-60 dark:text-grey-40 md:items-center justify-between"
      >
        <span>
          SendSmith is an independent relaunch based on Mozilla's archived
          Firefox Send source (MPL-2.0). Not affiliated with Mozilla.
        </span>
        <span class="mt-2 md:mt-0">
          <a href="/report-abuse" class="underline">Report abuse</a>
        </span>
      </footer>
    `;
  }
}

module.exports = Footer;
