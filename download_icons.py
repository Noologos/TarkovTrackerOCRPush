import requests
import os
import sys

GRAPHQL_URL = 'https://api.tarkov.dev/graphql'


KAPPA_TASK_ID = "5c51aac186f77432ea65c552"

QUERY = """
query KappaItems {
    task(id: "%s") {
        name
        objectives {
            ... on TaskObjectiveItem {
                id # Objective ID, not item ID
                items {
                    name
                    id # Item ID
                    gridImageLink
                }
            }
        }
    }
}
""" % KAPPA_TASK_ID


OUTPUT_DIR = 'kappa_items' 

def download_kappa_icons():
    """Fetches Kappa items and downloads their icons."""
    print(f"Fetching Kappa item data from {GRAPHQL_URL}...")
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}

    try:
        response = requests.post(GRAPHQL_URL, headers=headers, json={'query': QUERY})
        response.raise_for_status()
        data = response.json()

        if data.get('errors'):
            print("Error fetching data from GraphQL API:", file=sys.stderr)
            for error in data['errors']:
                print(f"- {error.get('message', 'Unknown error')}", file=sys.stderr)
            return

        kappa_task = data.get('data', {}).get('task')
        if not kappa_task or not kappa_task.get('objectives'):
            print("Could not find Kappa task or its objectives in the API response.", file=sys.stderr)
            return

        kappa_required_items = []
        for objective in kappa_task['objectives']:
            if objective and isinstance(objective.get('items'), list):
                kappa_required_items.extend(objective['items'])

        if not kappa_required_items:
            print("No required items found for the Kappa task.", file=sys.stderr)
            return

        print(f"Found {len(kappa_required_items)} required items for The Collector task.")

        if not os.path.exists(OUTPUT_DIR):
            os.makedirs(OUTPUT_DIR)
            print(f"Created directory: {OUTPUT_DIR}")

        downloaded_count = 0
        skipped_count = 0
        failed_download_count = 0
        total_items = len(kappa_required_items)

        print("\n--- Downloading Icons ---")
        for i, item in enumerate(kappa_required_items):
            item_id = item.get('id')
            icon_link = item.get('gridImageLink')
            item_name = item.get('name', 'Unknown Item')

            if not item_id:
                print(f"[{i+1}/{total_items}] Skipping item '{item_name}' - missing item ID.", file=sys.stderr)
                failed_download_count += 1
                continue

            if not icon_link:
                print(f"[{i+1}/{total_items}] Skipping item '{item_name}' (ID: {item_id}) - missing gridImageLink.", file=sys.stderr)
                failed_download_count += 1
                continue

            
            _, file_extension = os.path.splitext(icon_link)
            if not file_extension or len(file_extension) > 5 :
                file_extension = '.png'
            filename = f"{item_id}{file_extension}"
            filepath = os.path.join(OUTPUT_DIR, filename)

            if os.path.exists(filepath):
                print(f"[{i+1}/{total_items}] Icon for '{item_name}' ({item_id}) already exists: {filename}")
                skipped_count += 1
                continue

            print(f"[{i+1}/{total_items}] Downloading icon for '{item_name}' ({item_id}) from {icon_link} to {filename}...")
            try:
                img_response = requests.get(icon_link, stream=True, timeout=10)
                img_response.raise_for_status()
                with open(filepath, 'wb') as f:
                    for chunk in img_response.iter_content(chunk_size=8192):
                        f.write(chunk)
                downloaded_count += 1
                print(f"  Successfully downloaded {filename}")
            except requests.exceptions.RequestException as e:
                print(f"  Error downloading icon for '{item_name}' ({item_id}): {e}", file=sys.stderr)
                failed_download_count += 1
            except IOError as e:
                print(f"  Error saving icon file {filepath}: {e}", file=sys.stderr)
                failed_download_count += 1
            except Exception as e:
                print(f"  An unexpected error occurred for '{item_name}' ({item_id}): {e}", file=sys.stderr)
                failed_download_count += 1


        print("\n--- Download Summary ---")
        print(f"Total items to process: {total_items}")
        print(f"Successfully downloaded: {downloaded_count}")
        print(f"Already existed (skipped): {skipped_count}")
        print(f"Failed to download/save: {failed_download_count}")
        print(f"Icons are saved in '{OUTPUT_DIR}' directory.")

    except requests.exceptions.RequestException as e:
        print(f"Fatal API Error: Could not connect to or fetch data from {GRAPHQL_URL}. Error: {e}", file=sys.stderr)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    download_kappa_icons()