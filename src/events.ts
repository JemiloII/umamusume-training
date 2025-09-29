import { parse } from 'node-html-parser';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';
import EventData from '../data/events.json' with { type: 'json' };
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type ArchiveID = string | number;

type FindEventInput = {
  title: string;
  type: string;
  uma?: string;
};

type Choice = {
  choice: number;
  text?: string;
  success: string[];
  failure?: string[];
};

type UmamusumeEvent = {
  index: number;
  alias?: string;
  archive_id: ArchiveID;
  choices?: Choice[];
  title: string;
  type: string;
  uma: string;
};

const data: UmamusumeEvent[] = EventData;

const fetchEvent = async (archive_id: ArchiveID): Promise<Choice[]> => {
  const url = `https://game8.co/games/Umamusume-Pretty-Derby/archives/${ archive_id }`;
  const response = await fetch(url);
  const html = await response.text();

  return parseChoicesTable(html);
};

const parseChoicesTable = (html: string): Choice[] => {
  const document = parse(html);
  const table = document.querySelector('table');
  const rows = table.querySelectorAll('tr');
  const choices = {};

  rows.forEach((row, index) => {
    if (index === 0) {
      return;
    }

    const choiceCell = row.querySelector('td:first-child');
    const outcomeCell = row.querySelector('td:last-child');

    if (!choiceCell || !outcomeCell) {
      return;
    }

    const b = choiceCell.querySelector('b');
    if (!b) {
      return;
    }

    const choiceText = b.text;
    const choiceNumber = parseInt(choiceText.replace('Choice ', ''));

    const html = choiceCell.innerHTML;
    const after = html.match(/<\/b[^>]*>(.*)/s);
    const text = after ? after[1] : '';
    const clean = text.replace(/<hr[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    const outcomeHtml = outcomeCell.innerHTML;
    const outcomes = outcomeHtml
      .split('<br>')
      .map(item => item.replace(/・/g, '').trim())
      .filter(item => item.length > 0);

    if (!choices[choiceNumber]) {
      choices[choiceNumber] = {
        choice: choiceNumber,
        text: '',
        success: [],
        failure: []
      };
    }

    const paren = clean.match(/\(([^)]+)\)/);
    const content = paren ? paren[1] : '';

    if (content.toLowerCase() === 'success') {
      choices[choiceNumber].success = outcomes;
    } else if (content.toLowerCase() === 'fail') {
      choices[choiceNumber].failure = outcomes;
    } else if (content) {
      choices[choiceNumber].text = content;
      choices[choiceNumber].success = outcomes;
    } else {
      choices[choiceNumber].success = outcomes;
    }
  });

  return Object.values(choices);
};

const updateEvents = (index: number, choices: Choice[]) => {
  const filepath = join(__dirname, '../data/events.json');
  data[index]['choices'] = choices;
  writeFileSync(filepath, JSON.stringify(data, null, 2));
};

async function findEvent({ title, type, uma }: FindEventInput): Promise<Choice[]> {
  try {
    console.log('Event Type:', type, 'Uma:', uma, 'Title:', title);
    let events = data;
    console.log('Total Events:', events.length);
    if (type.toLowerCase() !== 'trainee') {
      events = events.filter(event => event.type.toLowerCase() === type.toLowerCase());
    } else {
      events = events.filter(event => {
        const eventUma = event.uma.toLowerCase();
        return eventUma === uma.toLowerCase() || eventUma === 'all umamusume';
      });
    }

    const { archive_id, index, choices }: UmamusumeEvent = events.find((event) => {
      return event.title.toLowerCase().startsWith(title.toLowerCase());
    });

    if (choices) {
      console.log('choices', choices);
      return choices;
    }

    const fetchedChoices: Choice[] = await fetchEvent(archive_id);
    updateEvents(index, fetchedChoices);

    console.log('choices', fetchedChoices);
    return fetchedChoices;
  } catch (error) {
    console.error('Events Search Error:', error);
    return null;
  }
}

export { Choice, findEvent };
